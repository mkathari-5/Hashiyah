import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { libraryBlocksRepo, libraryPagesRepo, ROOT_LIBRARY_PAGE_ID } from '@/db/repos/libraryPages'
import { libraryRepo } from '@/db/repos/libraryTree'
import { attachPdfToHost } from '@/services/library/bookAttachment'
import { openStudyWorkspace } from '@/services/library/openStudyWorkspace'
import { readWorkspaceHistory } from '@/services/library/workspaceHistory'
import { useAppStore } from '@/state/useAppStore'
import { useLibraryStore } from '@/state/useLibraryStore'
import { useNotesStore } from '@/state/useNotesStore'
import { useStudyStore } from '@/state/useStudyStore'

async function seedBook(id: string, title: string, pageCount = 80) {
  await db.books.add({
    id,
    subjectId: null,
    title,
    language: 'ar',
    pageCount,
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
    pageCount,
    createdAt: 1,
  })
}

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
  await libraryPagesRepo.ensureRoot()
  window.location.hash = ''
  useLibraryStore.setState({ activeNodeId: null, hydrated: true })
  useStudyStore.setState({ bookId: null, documentId: null, activeNoteId: null, currentPage: 1, zoom: 1 })
  useAppStore.setState({ layout: 'three' })
})

describe('openStudyWorkspace', () => {
  it('opens the three-panel workspace on the attached book', async () => {
    await seedBook('bk_1', 'Manhaj as-Salikeen')
    await db.readingStates.put({
      bookId: 'bk_1',
      pageNumber: 12,
      scrollRatio: 0.2,
      zoom: 1.25,
      activeNoteId: null,
      updatedAt: 1,
    })
    const attached = await attachPdfToHost({
      bookId: 'bk_1',
      createHostToggle: true,
      hostTitle: 'Manhaj as-Salikeen',
    })

    const result = await openStudyWorkspace({ libraryBlockId: attached!.block.id, forceThreePane: true })
    expect(result.ok).toBe(true)
    expect(useLibraryStore.getState().activeNodeId).toBe(attached!.node.id)
    expect(useStudyStore.getState().bookId).toBe('bk_1')
    expect(useStudyStore.getState().documentId).toBe('doc_bk_1')
    expect(useStudyStore.getState().currentPage).toBe(12)
    expect(useStudyStore.getState().zoom).toBe(1.25)
    expect(useAppStore.getState().layout).toBe('three')
    expect(useStudyStore.getState().activeNoteId).toBeTruthy()
    expect(readWorkspaceHistory()?.view).toBe('study')
  })

  it('opens a chapter with the parent book PDF and that chapter’s notes', async () => {
    await seedBook('bk_1', 'Manhaj as-Salikeen')
    const attached = await attachPdfToHost({
      bookId: 'bk_1',
      createHostToggle: true,
      hostTitle: 'Manhaj as-Salikeen',
    })
    const chapter = await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      parentBlockId: attached!.host!.id,
      type: 'toggle',
      content: 'Kitab at-Taharah',
    })

    await openStudyWorkspace({ libraryBlockId: chapter.id, forceThreePane: true })
    const node = await libraryRepo.get(useLibraryStore.getState().activeNodeId!)
    expect(node?.type).toBe('chapter')
    expect(node?.title).toBe('Kitab at-Taharah')
    expect(useStudyStore.getState().bookId).toBe('bk_1')
    expect(useStudyStore.getState().activeNoteId).toBe(node?.noteId)
    expect(node?.noteId).not.toBe(attached!.node.noteId)
  })

  it('scrolls to an exact nested note block when one is named', async () => {
    await seedBook('bk_1', 'Manhaj as-Salikeen')
    const attached = await attachPdfToHost({
      bookId: 'bk_1',
      createHostToggle: true,
      hostTitle: 'Manhaj as-Salikeen',
    })
    await openStudyWorkspace({
      libraryItemId: attached!.node.id,
      noteBlockId: 'blk_nested',
      history: 'none',
    })
    expect(useNotesStore.getState().pendingScroll).toMatchObject({
      noteId: useStudyStore.getState().activeNoteId,
      blockId: 'blk_nested',
    })
  })

  it('forwards a homepage row’s stored noteBlockId', async () => {
    await seedBook('bk_1', 'Manhaj as-Salikeen')
    const attached = await attachPdfToHost({
      bookId: 'bk_1',
      createHostToggle: true,
      hostTitle: 'Manhaj as-Salikeen',
    })
    const nested = await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      parentBlockId: attached!.host!.id,
      type: 'toggle',
      content: 'Wudu',
      noteBlockId: 'blk_wudu',
    })
    await openStudyWorkspace({ libraryBlockId: nested.id, noteBlockId: 'blk_wudu', history: 'none' })
    expect(useNotesStore.getState().pendingScroll).toMatchObject({ blockId: 'blk_wudu' })
    expect(useStudyStore.getState().bookId).toBe('bk_1')
  })

  it('returns to the homepage without clearing persisted notes', async () => {
    await seedBook('bk_1', 'Manhaj as-Salikeen')
    const attached = await attachPdfToHost({ bookId: 'bk_1', createHostToggle: true, hostTitle: 'Manhaj' })
    await openStudyWorkspace({ libraryItemId: attached!.node.id })
    const noteId = useStudyStore.getState().activeNoteId
    useLibraryStore.getState().showLibrary()
    expect(useLibraryStore.getState().activeNodeId).toBeNull()
    expect(await db.notes.get(noteId!)).toBeDefined()
    expect(readWorkspaceHistory()?.view).toBe('library')
  })

  it('opens notes and leaves the PDF empty when no file is attached', async () => {
    const node = await libraryRepo.create({ parentId: null, type: 'book', title: 'Notes only' })
    const result = await openStudyWorkspace({ libraryItemId: node.id, forceThreePane: true })
    expect(result.ok).toBe(true)
    expect(useStudyStore.getState().bookId).toBeNull()
    expect(useStudyStore.getState().activeNoteId).toBeTruthy()
  })

  it('reports a missing item instead of guessing by title', async () => {
    const result = await openStudyWorkspace({ libraryItemId: 'lib_missing' })
    expect(result).toEqual({ ok: false, reason: 'missing-item' })
    expect(useLibraryStore.getState().activeNodeId).toBeNull()
  })

  it('expands collapsed ancestors so the sidebar can show the selection', async () => {
    await seedBook('bk_1', 'Fiqh')
    const science = await libraryRepo.create({ parentId: null, type: 'science', title: 'Fiqh and Usul' })
    await libraryRepo.update(science.id, { collapsed: true })
    const book = await libraryRepo.create({
      parentId: science.id,
      type: 'book',
      title: 'Manhaj as-Salikeen',
      bookId: 'bk_1',
    })
    const chapter = await libraryRepo.create({
      parentId: book.id,
      type: 'chapter',
      title: 'Kitab at-Taharah',
      pageStart: 9,
    })
    await libraryRepo.update(book.id, { collapsed: true })

    await openStudyWorkspace({ libraryItemId: chapter.id })
    expect((await libraryRepo.get(science.id))?.collapsed).toBe(false)
    expect((await libraryRepo.get(book.id))?.collapsed).toBe(false)
    expect(useStudyStore.getState().currentPage).toBe(9)
  })

  it('keeps Arabic titles on the node that actually opened', async () => {
    await seedBook('bk_ar', 'المنهج')
    await db.books.update('bk_ar', { arabicTitle: 'منهج السالكين' })
    const attached = await attachPdfToHost({
      bookId: 'bk_ar',
      createHostToggle: true,
      hostTitle: 'منهج السالكين',
    })
    await openStudyWorkspace({ libraryBlockId: attached!.host!.id })
    expect((await libraryRepo.get(useLibraryStore.getState().activeNodeId!))?.title).toBe('منهج السالكين')
    expect(useStudyStore.getState().bookId).toBe('bk_ar')
  })
})
