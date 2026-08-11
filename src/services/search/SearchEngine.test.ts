import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import { search } from './SearchEngine'
import type { LibraryNode } from '@/types'

/**
 * Search scope (§E26).
 *
 * The library half of search reads the *tree*, and a chapter carries no book id
 * of its own — only the book above it does. So "this book" has to be resolved
 * structurally. The regression this file exists for: library and outline
 * results ignoring the scope entirely and returning every book's chapters.
 */

const BOOK_A = 'bk_tawhid'
const BOOK_B = 'bk_shubuhat'

async function seedBook(id: string, title: string) {
  await db.books.add({
    id,
    subjectId: null,
    title,
    language: 'ar',
    pageCount: 10,
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
    pageCount: 10,
    createdAt: 1,
  })
}

const toggle = (title: string, blockId: string) => ({
  type: 'toggleBlock',
  attrs: { blockId, open: true },
  content: [
    { type: 'toggleSummary', content: [{ type: 'text', text: title }] },
    { type: 'toggleContent', content: [{ type: 'paragraph' }] },
  ],
})

const heading = (text: string, blockId: string) => ({
  type: 'heading',
  attrs: { level: 1, blockId },
  content: [{ type: 'text', text }],
})

/** A book node with one chapter beneath it, the chapter holding a note. */
async function seedChapter(
  bookId: string,
  bookTitle: string,
  chapterTitle: string,
  noteId: string,
  content: unknown[],
): Promise<{ book: LibraryNode; chapter: LibraryNode }> {
  await seedBook(bookId, bookTitle)
  const book = await libraryRepo.create({ parentId: null, type: 'book', title: bookTitle, bookId })
  const chapter = await libraryRepo.create({
    parentId: book.id,
    type: 'chapter',
    title: chapterTitle,
    arabicTitle: 'باب الخوف من الشرك',
    noteId,
  })
  await db.notes.add({
    id: noteId,
    bookId,
    title: chapterTitle,
    outlineNodeId: null,
    lessonId: null,
    layerId: null,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  })
  await db.noteDocs.put({ noteId, doc: { type: 'doc', content }, updatedAt: 1 })
  return { book, chapter }
}

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('search scope', () => {
  /**
   * Both books contain a section with the same title — the situation in which
   * an unscoped search is indistinguishable from a scoped one until it isn't.
   */
  let chapterA: LibraryNode
  let chapterB: LibraryNode

  beforeEach(async () => {
    chapterA = (
      await seedChapter(BOOK_A, 'Kitāb at-Tawḥīd', 'Chapter 3', 'nt_a', [
        heading('Evidence from the Qurʾān', 'blk_a0'),
        toggle('What is Riyāʾ?', 'blk_a1'),
        toggle('معنى الرِّيَاء', 'blk_a2'),
      ])
    ).chapter
    chapterB = (
      await seedChapter(BOOK_B, 'Kashf ash-Shubuhāt', 'Chapter 1', 'nt_b', [
        toggle('What is Riyāʾ?', 'blk_b1'),
      ])
    ).chapter
  })

  it('returns only the open book’s outline entries when the scope is this book', async () => {
    const results = await search('Riyāʾ', 'book', { bookId: BOOK_A, documentId: `doc_${BOOK_A}` })

    expect(results.outline.map((h) => h.nodeId)).toEqual([chapterA.id])
    expect(results.outline.every((h) => h.bookId === BOOK_A)).toBe(true)
  })

  it('returns both books’ outline entries at library scope', async () => {
    const results = await search('Riyāʾ', 'library', { bookId: BOOK_A, documentId: `doc_${BOOK_A}` })

    expect(new Set(results.outline.map((h) => h.nodeId))).toEqual(new Set([chapterA.id, chapterB.id]))
  })

  it('scopes chapters by the book above them, not by a book id they do not have', async () => {
    // The chapters themselves carry no `bookId`; only their parent book node
    // does. This is exactly what an unscoped or naively scoped pass gets wrong.
    expect((await libraryRepo.get(chapterA.id))?.bookId).toBeNull()

    const results = await search('Chapter', 'book', { bookId: BOOK_A, documentId: `doc_${BOOK_A}` })

    expect(results.library.map((h) => h.nodeId)).toEqual([chapterA.id])
  })

  it('does not offer another book itself as a result of a scoped search', async () => {
    const results = await search('Kashf', 'book', { bookId: BOOK_A, documentId: `doc_${BOOK_A}` })

    expect(results.books).toEqual([])
    expect(results.library).toEqual([])
    expect(results.total).toBe(0)
  })

  it('finds the other book once the scope is widened', async () => {
    const results = await search('Kashf', 'library', { bookId: BOOK_A, documentId: `doc_${BOOK_A}` })

    expect(results.books.map((h) => h.bookId)).toContain(BOOK_B)
  })

  it('keeps a notes-only item, which belongs to no book, out of a scoped search', async () => {
    const node = await libraryRepo.create({
      parentId: null,
      type: 'notes',
      title: 'Questions about Riyāʾ to ask Ustādh',
    })

    const scoped = await search('Riyāʾ', 'book', { bookId: BOOK_A, documentId: `doc_${BOOK_A}` })
    expect(scoped.library.map((h) => h.nodeId)).not.toContain(node.id)

    const wide = await search('Riyāʾ', 'library', { bookId: BOOK_A, documentId: `doc_${BOOK_A}` })
    expect(wide.library.map((h) => h.nodeId)).toContain(node.id)
  })

  it('still ignores diacritics within a scoped search', async () => {
    // معنى الرِّيَاء is written vocalised in the note; the query is not.
    const results = await search('الرياء', 'book', { bookId: BOOK_A, documentId: `doc_${BOOK_A}` })

    expect(results.outline.map((h) => h.blockId)).toContain('blk_a2')
    expect(results.outline.every((h) => h.bookId === BOOK_A)).toBe(true)
  })

  it('finds a vocalised query against an unvocalised title, in both directions', async () => {
    const results = await search('الرِّيَاء', 'library', { bookId: null, documentId: null })
    expect(results.outline.map((h) => h.blockId)).toContain('blk_a2')
  })

  /**
   * §E26 — a result has to be enough to reopen the chapter and land on the
   * exact block: the node to select, the note to open, the block to scroll to.
   */
  it('carries the node, note and block a result needs to be navigable', async () => {
    const results = await search('Evidence from', 'book', { bookId: BOOK_A, documentId: `doc_${BOOK_A}` })

    const hit = results.outline.find((h) => h.blockId === 'blk_a0')
    expect(hit).toMatchObject({
      kind: 'outline',
      nodeId: chapterA.id,
      noteId: 'nt_a',
      blockId: 'blk_a0',
      bookId: BOOK_A,
    })
    // And it reads as its place in the library, so the reader knows which bāb.
    expect(hit?.path).toContain('Kitāb at-Tawḥīd')
  })

  it('scopes chapter notes as well as outline entries', async () => {
    const scoped = await search('Chapter 1', 'book', { bookId: BOOK_A, documentId: `doc_${BOOK_A}` })
    expect(scoped.notes.map((h) => h.noteId)).not.toContain('nt_b')

    const wide = await search('Chapter 1', 'library', { bookId: BOOK_A, documentId: `doc_${BOOK_A}` })
    expect(wide.notes.map((h) => h.noteId)).toContain('nt_b')
  })

  it('searches the whole library when no book is open', async () => {
    const results = await search('Riyāʾ', 'library', { bookId: null, documentId: null })
    expect(results.outline).toHaveLength(2)
  })

  it('ignores a query of fewer than two characters', async () => {
    expect((await search('ا', 'library', { bookId: null, documentId: null })).total).toBe(0)
  })
})
