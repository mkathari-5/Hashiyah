import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import { saveNote } from '@/services/notes/NotesService'
import { useLibraryStore } from '@/state/useLibraryStore'
import { useStudyStore } from '@/state/useStudyStore'

/**
 * Opening and reopening a chapter (§E10, §E31, §E45).
 *
 * Continue Studying is the promise that closing the app costs nothing: the same
 * book, the same chapter, the same notes document, the same page. All of that
 * hangs on a chapter's note being *stable* — created once and reused — so the
 * two are checked together here.
 */

const BOOK = 'bk_tawhid'

async function seedLibrary() {
  await db.books.add({
    id: BOOK,
    subjectId: null,
    title: 'Kitāb at-Tawḥīd',
    arabicTitle: 'كتاب التوحيد',
    language: 'ar',
    pageCount: 120,
    tags: [],
    favorite: false,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: null,
  })
  await db.documents.add({
    id: 'doc_1',
    bookId: BOOK,
    filename: 'tawhid.pdf',
    byteLength: 4,
    fingerprint: 'fp_1',
    pageCount: 120,
    createdAt: 1,
  })
  const book = await libraryRepo.create({ parentId: null, type: 'book', title: 'Kitāb at-Tawḥīd', bookId: BOOK })
  const three = await libraryRepo.create({
    parentId: book.id,
    type: 'chapter',
    title: 'Chapter 3',
    arabicTitle: 'باب الخوف من الشرك',
    pageStart: 41,
  })
  const four = await libraryRepo.create({
    parentId: book.id,
    type: 'chapter',
    title: 'Chapter 4',
    pageStart: 52,
  })
  return { book, three, four }
}

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
  useLibraryStore.setState({ activeNodeId: null, hydrated: false })
  useStudyStore.setState({ bookId: null, documentId: null, activeNoteId: null, currentPage: 1 })
})

describe('opening a chapter', () => {
  it('opens the book, its document, the chapter’s note and its page', async () => {
    const { three } = await seedLibrary()

    await useLibraryStore.getState().openNode(three.id)

    const study = useStudyStore.getState()
    expect(study.bookId).toBe(BOOK)
    expect(study.documentId).toBe('doc_1')
    expect(study.currentPage).toBe(41)
    expect(study.activeNoteId).toBe((await libraryRepo.get(three.id))?.noteId)
  })

  it('reopens the same note every time, never a second one', async () => {
    const { three, four } = await seedLibrary()

    await useLibraryStore.getState().openNode(three.id)
    const first = useStudyStore.getState().activeNoteId

    await useLibraryStore.getState().openNode(four.id)
    await useLibraryStore.getState().openNode(three.id)

    expect(useStudyStore.getState().activeNoteId).toBe(first)
    expect(await db.notes.count()).toBe(2)
  })

  it('keeps what was written in the chapter attached to that same note', async () => {
    const { three, four } = await seedLibrary()
    await useLibraryStore.getState().openNode(three.id)
    const noteId = useStudyStore.getState().activeNoteId!

    await saveNote(noteId, {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1, blockId: 'h1' }, content: [{ type: 'text', text: 'Evidence from the Qurʾān' }] }],
    })

    await useLibraryStore.getState().openNode(four.id)
    await useLibraryStore.getState().openNode(three.id)

    expect(useStudyStore.getState().activeNoteId).toBe(noteId)
    expect(await db.noteDocs.get(noteId)).toBeDefined()
    // §E5 — and the chapter is still called what the reader called it.
    expect((await db.notes.get(noteId))?.title).toBe('Chapter 3 — باب الخوف من الشرك')
    expect((await libraryRepo.get(three.id))?.title).toBe('Chapter 3')
  })
})

describe('Continue Studying', () => {
  it('restores the book, chapter, note and page from the last session', async () => {
    const { three } = await seedLibrary()
    await useLibraryStore.getState().openNode(three.id)
    const noteId = useStudyStore.getState().activeNoteId
    useStudyStore.getState().setPage(57)
    useStudyStore.getState().persistPosition(0.4)

    // A fresh start: nothing in memory, everything on disk.
    useLibraryStore.setState({ activeNodeId: null, hydrated: false })
    useStudyStore.setState({ bookId: null, documentId: null, activeNoteId: null, currentPage: 1 })

    await useLibraryStore.getState().hydrate()

    expect(useLibraryStore.getState().activeNodeId).toBe(three.id)
    const study = useStudyStore.getState()
    expect(study.bookId).toBe(BOOK)
    expect(study.documentId).toBe('doc_1')
    expect(study.activeNoteId).toBe(noteId)
    expect(study.restoredScrollRatio).toBe(0.4)
  })

  it('shows the library rather than a broken session if the chapter is gone', async () => {
    const { three } = await seedLibrary()
    await useLibraryStore.getState().openNode(three.id)
    await libraryRepo.remove(three.id)

    useLibraryStore.setState({ activeNodeId: null, hydrated: false })
    await useLibraryStore.getState().hydrate()

    expect(useLibraryStore.getState().activeNodeId).toBeNull()
    expect(useLibraryStore.getState().hydrated).toBe(true)
  })
})
