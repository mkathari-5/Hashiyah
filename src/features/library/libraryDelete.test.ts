import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import { notesRepo } from '@/db/repos/notes'
import {
  deleteLibraryNode,
  inspectNodeDeletion,
  restoreNodeDeletion,
} from '@/features/library/libraryDelete'
import { useLibraryStore } from '@/state/useLibraryStore'
import { useStudyStore } from '@/state/useStudyStore'

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
  useLibraryStore.setState({ activeNodeId: null })
  useStudyStore.setState({ activeNoteId: null, bookId: null })
})

describe('library deletion', () => {
  it('deletes an empty leaf immediately', async () => {
    const node = await libraryRepo.create({ parentId: null, type: 'chapter', title: 'Scratch' })
    const impact = await inspectNodeDeletion(node.id)
    expect(impact?.needsConfirm).toBe(false)
    await deleteLibraryNode(node.id)
    expect(await libraryRepo.get(node.id)).toBeUndefined()
  })

  it('requires confirmation for nested branches and restores them', async () => {
    const parent = await libraryRepo.create({ parentId: null, type: 'book', title: 'Kitab at-Taharah' })
    await libraryRepo.create({ parentId: parent.id, type: 'chapter', title: 'Wudu' })
    await libraryRepo.create({ parentId: parent.id, type: 'chapter', title: 'Ghusl' })
    const impact = await inspectNodeDeletion(parent.id)
    expect(impact?.needsConfirm).toBe(true)
    expect(impact?.nestedCount).toBe(2)
    expect(impact?.summary).toContain('2 nested items')
    const snapshot = await deleteLibraryNode(parent.id)
    expect(snapshot).toBeTruthy()
    expect(await libraryRepo.children(null)).toHaveLength(0)
    await restoreNodeDeletion(snapshot!)
    expect((await libraryRepo.children(null)).map((row) => row.title)).toEqual(['Kitab at-Taharah'])
    expect((await libraryRepo.children(parent.id)).map((row) => row.title)).toEqual(['Wudu', 'Ghusl'])
  })

  it('does not delete when the confirmation path is cancelled', async () => {
    const node = await libraryRepo.create({ parentId: null, type: 'chapter', title: 'Keep me' })
    const impact = await inspectNodeDeletion(node.id)
    expect(impact).toBeTruthy()
    expect(await libraryRepo.get(node.id)).toBeTruthy()
  })

  it('selects a sibling after deleting the active node', async () => {
    const first = await libraryRepo.create({ parentId: null, type: 'chapter', title: 'First' })
    const second = await libraryRepo.create({ parentId: null, type: 'chapter', title: 'Second' })
    useLibraryStore.setState({ activeNodeId: first.id })
    const snapshot = await deleteLibraryNode(first.id)
    expect(snapshot?.selectAfter).toBe(second.id)
    expect(useLibraryStore.getState().activeNodeId).toBe(second.id)
  })

  it('keeps the PDF and removes only the node notes', async () => {
    const bookId = 'book_keep'
    await db.books.add({
      id: bookId,
      subjectId: null,
      title: 'Kept PDF',
      language: 'ar',
      pageCount: 2,
      tags: [],
      favorite: false,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1,
    })
    const note = await notesRepo.create({ bookId, title: 'Chapter notes' })
    const node = await libraryRepo.create({
      parentId: null,
      type: 'chapter',
      title: 'With PDF',
      bookId,
      noteId: note.id,
    })
    const impact = await inspectNodeDeletion(node.id)
    expect(impact?.hasPdf).toBe(true)
    expect(impact?.needsConfirm).toBe(true)
    await deleteLibraryNode(node.id)
    expect(await db.books.get(bookId)).toBeTruthy()
    expect(await notesRepo.get(note.id)).toBeUndefined()
  })

  it('flags source anchors on the node notes', async () => {
    const note = await notesRepo.create({ bookId: null, title: 'Quoted' })
    await db.quoteRefs.add({
      id: `${note.id}:b1`,
      noteId: note.id,
      annotationId: 'ann_1',
      blockId: 'b1',
      order: 0,
    })
    const node = await libraryRepo.create({
      parentId: null,
      type: 'chapter',
      title: 'Anchored',
      noteId: note.id,
    })
    const impact = await inspectNodeDeletion(node.id)
    expect(impact?.hasCaptures).toBe(true)
    expect(impact?.needsConfirm).toBe(true)
  })

  it('deletes a deeply nested branch and selects the parent afterwards', async () => {
    const root = await libraryRepo.create({ parentId: null, type: 'science', title: 'Fiqh' })
    const book = await libraryRepo.create({ parentId: root.id, type: 'book', title: 'Kitab' })
    const chapter = await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'Taharah' })
    await libraryRepo.create({ parentId: chapter.id, type: 'chapter', title: 'Wudu' })
    useLibraryStore.setState({ activeNodeId: book.id })
    const impact = await inspectNodeDeletion(book.id)
    expect(impact?.nestedCount).toBe(2)
    const snapshot = await deleteLibraryNode(book.id)
    expect(await libraryRepo.get(book.id)).toBeUndefined()
    expect(await libraryRepo.get(chapter.id)).toBeUndefined()
    expect(await libraryRepo.get(root.id)).toBeTruthy()
    expect(snapshot?.selectAfter).toBe(root.id)
    expect(useLibraryStore.getState().activeNodeId).toBe(root.id)
  })
})
