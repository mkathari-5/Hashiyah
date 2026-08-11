import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import { bootstrapLibrary, ensureNodeNote, DEFAULT_SCIENCES } from './bootstrap'

/**
 * Library bootstrap safety (§E3, §E6, §E7).
 *
 * The two things that would genuinely hurt a reader are duplicated sciences
 * and an orphaned PDF. Both are checked here directly, including the case that
 * matters most: running the bootstrap repeatedly, which happens on every start.
 */

async function clearAll() {
  await Promise.all(db.tables.map((t) => t.clear()))
}

async function seedBook(id: string, title: string, subjectId: string | null) {
  await db.books.add({
    id,
    subjectId,
    title,
    arabicTitle: 'كتاب التوحيد',
    language: 'ar',
    pageCount: 100,
    tags: [],
    favorite: false,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: null,
  })
  await db.documents.add({
    id: `doc_${id}`,
    bookId: id,
    filename: `${id}.pdf`,
    byteLength: 4,
    fingerprint: `fp_${id}`,
    pageCount: 100,
    createdAt: 1,
  })
  await db.annotations.add({
    id: `ann_${id}`,
    bookId: id,
    documentId: `doc_${id}`,
    pageNumber: 17,
    kind: 'explain',
    color: 'amber',
    selectedText: 'الحنيفية ملة إبراهيم',
    normalizedText: 'الحنيفيه مله ابراهيم',
    textSource: 'embedded',
    layerId: null,
    lessonId: null,
    createdAt: 1,
    updatedAt: 1,
  })
}

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await clearAll()
})

describe('bootstrapLibrary', () => {
  it('seeds the default sciences for an empty library', async () => {
    const result = await bootstrapLibrary()
    expect(result.createdSciences).toBe(DEFAULT_SCIENCES.length)

    const nodes = await libraryRepo.children(null)
    expect(nodes.map((n) => n.title)).toEqual(DEFAULT_SCIENCES.map((s) => s.title))
    expect(nodes.every((n) => n.type === 'science')).toBe(true)
  })

  it('is idempotent — running it repeatedly never duplicates a science', async () => {
    await bootstrapLibrary()
    await bootstrapLibrary()
    const third = await bootstrapLibrary()

    const nodes = await libraryRepo.children(null)
    expect(nodes).toHaveLength(DEFAULT_SCIENCES.length)

    const titles = nodes.map((n) => n.title)
    expect(new Set(titles).size).toBe(titles.length)
    expect(third.alreadyPresent).toBe(true)
  })

  /**
   * The regression that sequential calls miss entirely.
   *
   * React StrictMode invokes start-up effects twice, and two tabs can open at
   * once. Both callers read an empty table before either writes, so a naive
   * "check then create" produces the whole default set twice. This is exactly
   * how the live database ended up with sixteen nodes instead of eight.
   */
  it('survives concurrent invocation without duplicating anything', async () => {
    await Promise.all([bootstrapLibrary(), bootstrapLibrary(), bootstrapLibrary()])

    const nodes = await libraryRepo.children(null)
    expect(nodes).toHaveLength(DEFAULT_SCIENCES.length)
    expect(new Set(nodes.map((n) => n.title)).size).toBe(DEFAULT_SCIENCES.length)
  })

  it('does not link a book twice when invoked concurrently', async () => {
    await seedBook('bk_1', 'Kitāb at-Tawḥīd', null)
    await Promise.all([bootstrapLibrary(), bootstrapLibrary()])

    const bookNodes = (await libraryRepo.all()).filter((n) => n.bookId === 'bk_1')
    expect(bookNodes).toHaveLength(1)
  })

  it('repairs a library that already contains duplicates', async () => {
    // Simulate the damage the earlier race caused: every science twice.
    for (const science of DEFAULT_SCIENCES) {
      await libraryRepo.create({ parentId: null, type: 'science', title: science.title })
      await libraryRepo.create({ parentId: null, type: 'science', title: science.title })
    }
    expect(await libraryRepo.children(null)).toHaveLength(DEFAULT_SCIENCES.length * 2)

    const result = await bootstrapLibrary()

    expect(result.repairedDuplicates).toBe(DEFAULT_SCIENCES.length)
    const nodes = await libraryRepo.children(null)
    expect(nodes).toHaveLength(DEFAULT_SCIENCES.length)
    expect(new Set(nodes.map((n) => n.title)).size).toBe(DEFAULT_SCIENCES.length)
  })

  it('keeps whichever duplicate holds the content, and never strands a book', async () => {
    const empty = await libraryRepo.create({ parentId: null, type: 'science', title: 'ʿAqīdah and Uṣūl ad-Dīn' })
    const withBook = await libraryRepo.create({ parentId: null, type: 'science', title: 'ʿAqīdah and Uṣūl ad-Dīn' })
    const book = await libraryRepo.create({ parentId: withBook.id, type: 'book', title: 'Kitāb at-Tawḥīd' })

    await bootstrapLibrary()

    // Exactly one ʿAqīdah remains…
    const aqidah = (await libraryRepo.children(null)).filter((n) => n.title.startsWith('ʿAqīdah'))
    expect(aqidah).toHaveLength(1)

    // …it is the one that had the book, and the book is still under it.
    expect(aqidah[0].id).toBe(withBook.id)
    expect(await libraryRepo.get(empty.id)).toBeUndefined()
    const survivor = await libraryRepo.get(book.id)
    expect(survivor?.parentId).toBe(withBook.id)
  })

  it('never discards a duplicate that has its own notes', async () => {
    await libraryRepo.create({ parentId: null, type: 'science', title: 'Fiqh and Uṣūl al-Fiqh' })
    const withNotes = await libraryRepo.create({ parentId: null, type: 'science', title: 'Fiqh and Uṣūl al-Fiqh' })
    const noteId = await ensureNodeNote(withNotes.id)

    await bootstrapLibrary()

    // The notes survive, adopted by whichever node remains.
    expect(await db.notes.get(noteId!)).toBeDefined()
    const fiqh = (await libraryRepo.children(null)).filter((n) => n.title.startsWith('Fiqh'))
    expect(fiqh).toHaveLength(1)
    expect(fiqh[0].noteId).toBe(noteId)
  })

  it("carries an existing reader's own subjects across instead of overriding them", async () => {
    await db.subjects.bulkAdd([
      { id: 'sub_1', parentId: null, name: 'Manhaj', order: 0, createdAt: 1, updatedAt: 1 },
      { id: 'sub_2', parentId: null, name: 'Modern Day Topics', order: 1, createdAt: 1, updatedAt: 1 },
    ])

    const result = await bootstrapLibrary()
    expect(result.migratedSubjects).toBe(2)

    const titles = (await libraryRepo.children(null)).map((n) => n.title)
    expect(titles).toContain('Manhaj')
    expect(titles).toContain('Modern Day Topics')
    // Their own sections come first; defaults fill in behind them.
    expect(titles.slice(0, 2)).toEqual(['Manhaj', 'Modern Day Topics'])
  })

  it('does not duplicate a subject that differs only by transliteration', async () => {
    await db.subjects.add({
      id: 'sub_1',
      parentId: null,
      // Same science, written without the diacritics used in the defaults.
      name: 'Aqidah and Usul ad-Din',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    await bootstrapLibrary()
    await bootstrapLibrary()

    const titles = (await libraryRepo.children(null)).map((n) => n.title)
    const aqidah = titles.filter((t) => t.toLowerCase().includes('din'))
    expect(aqidah).toHaveLength(1)
  })

  it('links every existing book to a node without copying or orphaning it', async () => {
    await db.subjects.add({ id: 'sub_1', parentId: null, name: 'ʿAqīdah and Uṣūl ad-Dīn', order: 0, createdAt: 1, updatedAt: 1 })
    await seedBook('bk_1', 'Kitāb at-Tawḥīd', 'sub_1')

    const result = await bootstrapLibrary()
    expect(result.linkedBooks).toBe(1)

    const nodes = await libraryRepo.all()
    const bookNode = nodes.find((n) => n.type === 'book')
    expect(bookNode?.bookId).toBe('bk_1')

    // The node sits under the science the book was already filed in.
    const science = nodes.find((n) => n.id === bookNode?.parentId)
    expect(science?.title).toBe('ʿAqīdah and Uṣūl ad-Dīn')

    // And the underlying records are entirely untouched.
    expect(await db.books.get('bk_1')).toBeDefined()
    expect(await db.documents.get('doc_bk_1')).toBeDefined()
    expect(await db.annotations.get('ann_bk_1')).toBeDefined()
  })

  it('never links the same book twice', async () => {
    await seedBook('bk_1', 'Kitāb at-Tawḥīd', null)
    await bootstrapLibrary()
    await bootstrapLibrary()

    const bookNodes = (await libraryRepo.all()).filter((n) => n.bookId === 'bk_1')
    expect(bookNodes).toHaveLength(1)
  })

  it('files an unfiled book somewhere findable rather than losing it', async () => {
    await seedBook('bk_1', 'Unfiled book', null)
    await bootstrapLibrary()

    const bookNode = (await libraryRepo.all()).find((n) => n.bookId === 'bk_1')
    expect(bookNode).toBeDefined()
    expect(bookNode!.parentId).not.toBeNull()
  })
})

describe('ensureNodeNote', () => {
  it('creates one stable note and reuses it forever after', async () => {
    await bootstrapLibrary()
    const science = (await libraryRepo.children(null))[0]
    const chapter = await libraryRepo.create({
      parentId: science.id,
      type: 'chapter',
      title: 'Chapter 3',
      arabicTitle: 'باب الخوف من الشرك',
    })

    const first = await ensureNodeNote(chapter.id)
    const second = await ensureNodeNote(chapter.id)
    const third = await ensureNodeNote(chapter.id)

    expect(first).toBeTruthy()
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(await db.notes.count()).toBe(1)
  })

  it('names the note from both titles so it reads correctly in the list', async () => {
    await bootstrapLibrary()
    const science = (await libraryRepo.children(null))[0]
    const chapter = await libraryRepo.create({
      parentId: science.id,
      type: 'chapter',
      title: 'Chapter 3',
      arabicTitle: 'باب الخوف من الشرك',
    })
    const noteId = await ensureNodeNote(chapter.id)
    const note = await db.notes.get(noteId!)
    expect(note?.title).toBe('Chapter 3 — باب الخوف من الشرك')
  })

  /**
   * A chapter carries no `bookId` of its own — only its parent book does. The
   * first implementation took the node's own field, so every chapter note was
   * created unattached and never appeared in the book's notes panel.
   */
  it("attaches a chapter's notes to the book above it, not to nothing", async () => {
    await seedBook('bk_1', 'Kitāb at-Tawḥīd', null)
    await bootstrapLibrary()

    const bookNode = (await libraryRepo.all()).find((n) => n.bookId === 'bk_1')!
    const chapter = await libraryRepo.create({
      parentId: bookNode.id,
      type: 'chapter',
      title: 'Chapter 3',
      arabicTitle: 'باب الخوف من الشرك',
    })

    const noteId = await ensureNodeNote(chapter.id)
    const note = await db.notes.get(noteId!)
    expect(note?.bookId).toBe('bk_1')

    // And so it is listed among the book's notes.
    const forBook = await db.notes.where('bookId').equals('bk_1').toArray()
    expect(forBook.map((n) => n.id)).toContain(noteId)
  })

  it('leaves a notes-only item unattached, since it has no book', async () => {
    await bootstrapLibrary()
    const science = (await libraryRepo.children(null))[0]
    const node = await libraryRepo.create({
      parentId: science.id,
      type: 'notes',
      title: 'Questions to ask Ustādh',
    })

    const noteId = await ensureNodeNote(node.id)
    expect((await db.notes.get(noteId!))?.bookId).toBeNull()
  })

  it('resolves through several levels of nesting', async () => {
    await seedBook('bk_1', 'Kitāb at-Tawḥīd', null)
    await bootstrapLibrary()
    const bookNode = (await libraryRepo.all()).find((n) => n.bookId === 'bk_1')!

    const part = await libraryRepo.create({ parentId: bookNode.id, type: 'folder', title: 'Part One' })
    const chapter = await libraryRepo.create({ parentId: part.id, type: 'chapter', title: 'Chapter 3' })

    const noteId = await ensureNodeNote(chapter.id)
    expect((await db.notes.get(noteId!))?.bookId).toBe('bk_1')
  })

  it('recovers if the linked note was deleted elsewhere', async () => {
    await bootstrapLibrary()
    const science = (await libraryRepo.children(null))[0]
    const node = await libraryRepo.create({ parentId: science.id, type: 'notes', title: 'Questions to ask Ustādh' })

    const first = await ensureNodeNote(node.id)
    await db.notes.delete(first!)
    const second = await ensureNodeNote(node.id)

    expect(second).not.toBe(first)
    expect(await db.notes.get(second!)).toBeDefined()
  })
})

describe('libraryRepo.remove', () => {
  it('removes a chapter without touching the book it pointed at', async () => {
    await seedBook('bk_1', 'Kitāb at-Tawḥīd', null)
    await bootstrapLibrary()

    const bookNode = (await libraryRepo.all()).find((n) => n.bookId === 'bk_1')!
    const chapter = await libraryRepo.create({ parentId: bookNode.id, type: 'chapter', title: 'Chapter 1' })
    await ensureNodeNote(chapter.id)

    await libraryRepo.remove(chapter.id)

    expect(await libraryRepo.get(chapter.id)).toBeUndefined()
    expect(await db.books.get('bk_1')).toBeDefined()
    expect(await db.documents.get('doc_bk_1')).toBeDefined()
    expect(await db.annotations.get('ann_bk_1')).toBeDefined()
  })

  it('removes descendants with the node', async () => {
    await bootstrapLibrary()
    const science = (await libraryRepo.children(null))[0]
    const book = await libraryRepo.create({ parentId: science.id, type: 'book', title: 'A book' })
    const chapter = await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'Chapter 1' })

    await libraryRepo.remove(book.id)

    expect(await libraryRepo.get(book.id)).toBeUndefined()
    expect(await libraryRepo.get(chapter.id)).toBeUndefined()
    expect(await libraryRepo.get(science.id)).toBeDefined()
  })
})

describe('libraryRepo.move', () => {
  it('reorders siblings densely', async () => {
    await bootstrapLibrary()
    const before = await libraryRepo.children(null)
    const last = before[before.length - 1]

    await libraryRepo.move(last.id, null, 0)

    const after = await libraryRepo.children(null)
    expect(after[0].id).toBe(last.id)
    expect(after.map((n) => n.order)).toEqual(after.map((_, i) => i))
  })

  it('moves a book into a different science', async () => {
    await bootstrapLibrary()
    const sciences = await libraryRepo.children(null)
    const book = await libraryRepo.create({ parentId: sciences[0].id, type: 'book', title: 'A book' })

    await libraryRepo.move(book.id, sciences[1].id, 0)

    expect((await libraryRepo.get(book.id))?.parentId).toBe(sciences[1].id)
    expect(await libraryRepo.children(sciences[0].id)).toHaveLength(0)
  })

  it('refuses to make a node its own descendant', async () => {
    await bootstrapLibrary()
    const science = (await libraryRepo.children(null))[0]
    const book = await libraryRepo.create({ parentId: science.id, type: 'book', title: 'A book' })
    const chapter = await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'Chapter 1' })

    await libraryRepo.move(book.id, chapter.id, 0)

    // Unchanged — the move was rejected rather than corrupting the tree.
    expect((await libraryRepo.get(book.id))?.parentId).toBe(science.id)
  })
})
