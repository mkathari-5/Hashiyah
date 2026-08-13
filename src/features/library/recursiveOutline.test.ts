import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import {
  STUDY_ITEM,
  canNestUnder,
  canSitAtRoot,
  childTypeFor,
} from '@/features/library/libraryOutline'
import { ensureNodeNote, resolveBookId } from '@/services/library/bootstrap'

/**
 * Recursive study items (§4, §25).
 *
 * The library used to stop at Science → Book → Chapter. These tests pin the
 * invariant that replaced it: below a book, every item can contain more items,
 * without limit, and everything that made a chapter useful — a stable note, the
 * book's PDF, its place in the tree — keeps working however deep it sits.
 */

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
})

/** Builds the §25 hierarchy and returns every node by title. */
async function buildDeepLibrary() {
  const science = await libraryRepo.create({ parentId: null, type: 'science', title: 'Fiqh and Uṣūl al-Fiqh' })

  await db.books.add({
    id: 'bk_manhaj',
    subjectId: null,
    title: 'Manhaj as-Sālikīn',
    arabicTitle: 'منهج السالكين',
    language: 'ar',
    pageCount: 300,
    tags: [],
    favorite: false,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: null,
  })

  const book = await libraryRepo.create({
    parentId: science.id,
    type: 'book',
    title: 'Manhaj as-Sālikīn',
    bookId: 'bk_manhaj',
  })

  const chain = [
    'Kitāb al-Buyūʿ',
    'Conditions of Transactions',
    'First Condition — ar-Riḍā',
    "Ustādh's Explanation",
    'Exception',
    'Further Explanation',
  ]

  const nodes: Record<string, string> = { science: science.id, book: book.id }
  let parentId = book.id
  for (const title of chain) {
    const type = childTypeFor((await libraryRepo.get(parentId))!.type)!
    const node = await libraryRepo.create({ parentId, type, title })
    nodes[title] = node.id
    parentId = node.id
  }
  return nodes
}

describe('recursive study items', () => {
  it('never runs out of levels below a book', async () => {
    const nodes = await buildDeepLibrary()

    // Six items below the book, each inside the last.
    const deepest = await libraryRepo.get(nodes['Further Explanation'])
    expect(deepest).toBeDefined()

    let depth = 0
    let current = deepest
    while (current?.parentId) {
      current = await libraryRepo.get(current.parentId)
      depth += 1
    }
    // Further Explanation → Exception → Ustādh → ar-Riḍā → Conditions →
    // Kitāb al-Buyūʿ → book → science
    expect(depth).toBe(7)
  })

  it('keeps offering a child type at every depth', async () => {
    const nodes = await buildDeepLibrary()
    for (const id of Object.values(nodes)) {
      const node = await libraryRepo.get(id)
      expect(childTypeFor(node!.type)).not.toBeNull()
    }
  })

  it('allows a study item under a study item, but never at the root', () => {
    expect(canNestUnder(STUDY_ITEM, STUDY_ITEM)).toBe(true)
    expect(canNestUnder(STUDY_ITEM, 'book')).toBe(true)
    // The old dead ends.
    expect(canNestUnder(STUDY_ITEM, 'lesson')).toBe(true)
    expect(canNestUnder(STUDY_ITEM, 'notes')).toBe(true)
    // Structure above a book still means something.
    expect(canNestUnder('book', STUDY_ITEM)).toBe(false)
    expect(canSitAtRoot(STUDY_ITEM)).toBe(false)
    expect(canSitAtRoot('book')).toBe(true)
  })

  it('resolves the book through many ancestors', async () => {
    const nodes = await buildDeepLibrary()
    const deepest = await libraryRepo.get(nodes['Further Explanation'])
    // Six levels below the node that actually carries the bookId.
    expect(await resolveBookId(deepest!)).toBe('bk_manhaj')
  })

  it('gives a deep item its own stable note, reused on every open', async () => {
    const nodes = await buildDeepLibrary()
    const id = nodes['Further Explanation']

    const first = await ensureNodeNote(id)
    const second = await ensureNodeNote(id)
    expect(first).toBeTruthy()
    expect(second).toBe(first)
    expect(await db.notes.count()).toBe(1)

    // And it belongs to the book six levels above it.
    expect((await db.notes.get(first!))?.bookId).toBe('bk_manhaj')
  })

  it('gives siblings at the same depth different notes', async () => {
    const nodes = await buildDeepLibrary()
    const parent = nodes["Ustādh's Explanation"]
    const one = await libraryRepo.create({ parentId: parent, type: STUDY_ITEM, title: 'Point One' })
    const two = await libraryRepo.create({ parentId: parent, type: STUDY_ITEM, title: 'Point Two' })

    const noteOne = await ensureNodeNote(one.id)
    const noteTwo = await ensureNodeNote(two.id)
    expect(noteOne).not.toBe(noteTwo)
  })

  it('moves an item from shallow to deep and keeps its subtree', async () => {
    const nodes = await buildDeepLibrary()

    // A separate branch near the top, with a child of its own.
    const branch = await libraryRepo.create({
      parentId: nodes['Kitāb al-Buyūʿ'],
      type: STUDY_ITEM,
      title: 'Chapter: al-Khiyār',
    })
    await libraryRepo.create({ parentId: branch.id, type: STUDY_ITEM, title: 'khiyār al-majlis' })

    // Depth 2 below the book → depth 6, which the old drop rule could not do.
    await libraryRepo.move(branch.id, nodes['Exception'], 0)

    expect((await libraryRepo.get(branch.id))?.parentId).toBe(nodes['Exception'])
    const kids = await libraryRepo.children(branch.id)
    expect(kids.map((k) => k.title)).toEqual(['khiyār al-majlis'])
  })

  it('refuses to move an item inside its own descendant', async () => {
    const nodes = await buildDeepLibrary()
    const ancestor = nodes['Kitāb al-Buyūʿ']
    const descendant = nodes['Further Explanation']

    await libraryRepo.move(ancestor, descendant, 0)

    // Unchanged — the cycle was rejected rather than corrupting the tree.
    expect((await libraryRepo.get(ancestor))?.parentId).toBe(nodes.book)
  })

  it('deletes a deep branch without touching the book', async () => {
    const nodes = await buildDeepLibrary()
    const branch = nodes['First Condition — ar-Riḍā']
    await ensureNodeNote(branch)
    const descendants = await libraryRepo.descendants(branch)
    expect(descendants.length).toBeGreaterThan(0)

    await libraryRepo.remove(branch)

    expect(await libraryRepo.get(branch)).toBeUndefined()
    for (const d of descendants) expect(await libraryRepo.get(d.id)).toBeUndefined()
    // The book and its PDF record are untouched.
    expect(await db.books.get('bk_manhaj')).toBeDefined()
    expect(await libraryRepo.get(nodes.book)).toBeDefined()
  })

  it('survives a reload with position, depth and notes intact', async () => {
    const nodes = await buildDeepLibrary()
    const deepest = nodes['Further Explanation']
    const noteId = await ensureNodeNote(deepest)
    await libraryRepo.update(deepest, { collapsed: false, favorite: true })

    // Reopen the database exactly as a restart would.
    db.close()
    await Dexie.waitFor(db.open())

    const reloaded = await libraryRepo.get(deepest)
    expect(reloaded?.parentId).toBe(nodes['Exception'])
    expect(reloaded?.noteId).toBe(noteId)
    expect(reloaded?.collapsed).toBe(false)
    expect(reloaded?.favorite).toBe(true)
    expect(await ensureNodeNote(deepest)).toBe(noteId)
  })

  it('carries mixed Arabic and English titles to any depth', async () => {
    const nodes = await buildDeepLibrary()
    const child = await libraryRepo.create({
      parentId: nodes['Further Explanation'],
      type: STUDY_ITEM,
      title: 'Chapter 3',
      arabicTitle: 'باب الخوف من الشرك',
    })
    const reloaded = await libraryRepo.get(child.id)
    expect(reloaded?.title).toBe('Chapter 3')
    expect(reloaded?.arabicTitle).toBe('باب الخوف من الشرك')
  })
})

describe('existing chapters become recursive without migration', () => {
  it('lets a chapter stored before this change take children', async () => {
    // Exactly what an older database holds: type 'chapter', no children.
    const science = await libraryRepo.create({ parentId: null, type: 'science', title: 'ʿAqīdah' })
    const book = await libraryRepo.create({ parentId: science.id, type: 'book', title: 'Kitāb at-Tawḥīd' })
    const legacy = await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'Fear of Shirk' })

    // No rewrite, no new id — it simply accepts children now.
    const child = await libraryRepo.create({
      parentId: legacy.id,
      type: childTypeFor(legacy.type)!,
      title: 'First Āyah used as evidence',
    })

    expect(child.parentId).toBe(legacy.id)
    expect((await libraryRepo.get(legacy.id))?.id).toBe(legacy.id)
    expect((await libraryRepo.get(legacy.id))?.type).toBe('chapter')
  })
})
