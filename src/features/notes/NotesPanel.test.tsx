import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import { NotesPanel } from '@/features/notes/NotesPanel'
import { useAppStore } from '@/state/useAppStore'
import { useNotesStore } from '@/state/useNotesStore'
import { useStudyStore } from '@/state/useStudyStore'

/**
 * §F.1 — library-owned notes keep their identity and lifecycle in the Library.
 * The Notes panel must not offer Rename/Delete for them, and tabs must show the
 * owning node's title rather than a stale derived note.title.
 */

async function seedBook(bookId: string) {
  await db.books.add({
    id: bookId,
    subjectId: null,
    title: 'Kitāb at-Tawḥīd',
    arabicTitle: 'كتاب التوحيد',
    language: 'ar',
    pageCount: 10,
    tags: [],
    favorite: false,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
  })
}

async function seedNote(noteId: string, bookId: string | null, title: string, order = 0) {
  await db.notes.add({
    id: noteId,
    bookId,
    title,
    outlineNodeId: null,
    lessonId: null,
    layerId: null,
    order,
    createdAt: 1,
    updatedAt: 1,
  })
  await db.noteDocs.put({
    noteId,
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }] },
    updatedAt: 1,
  })
}

async function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Document options' }))
  const menu = document.body.querySelector('.notes-menu')
  expect(menu).toBeTruthy()
  return within(menu as HTMLElement)
}

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
  useNotesStore.setState({ revision: null })
  useStudyStore.setState({
    activeNoteId: null,
    bookId: null,
    documentId: null,
  })
  useAppStore.setState({ layout: 'three', saving: false, savedAt: null })
})

describe('NotesPanel — library-owned note menu', () => {
  it('hides Rename note and Delete note for a library-owned chapter note', async () => {
    await seedBook('bk1')
    await seedNote('nt_ch', 'bk1', 'Evidence from the Qurʾān')
    await libraryRepo.create({
      parentId: null,
      type: 'chapter',
      title: 'Chapter 3',
      arabicTitle: 'باب الخوف من الشرك',
      noteId: 'nt_ch',
    })
    act(() => useStudyStore.setState({ bookId: 'bk1', activeNoteId: 'nt_ch' }))

    render(<NotesPanel />)
    await waitFor(() => expect(screen.getByText('Chapter 3')).toBeInTheDocument())

    const menu = await openMenu()
    expect(menu.queryByText('Rename note')).toBeNull()
    expect(menu.queryByText('Delete note')).toBeNull()
    expect(menu.getByText('Find in note')).toBeInTheDocument()
  })

  it('keeps Rename note and Delete note for a standalone note', async () => {
    await seedBook('bk1')
    await seedNote('nt_free', 'bk1', 'Scratch pad')
    act(() => useStudyStore.setState({ bookId: 'bk1', activeNoteId: 'nt_free' }))

    render(<NotesPanel />)
    await waitFor(() => expect(screen.getByText('Scratch pad')).toBeInTheDocument())

    const menu = await openMenu()
    expect(menu.getByText('Rename note')).toBeInTheDocument()
    expect(menu.getByText('Delete note')).toBeInTheDocument()
  })
})

describe('NotesPanel — tab titles', () => {
  it('shows the library node title on a library-owned tab, not a stale note.title', async () => {
    await seedBook('bk1')
    await seedNote('nt_ch', 'bk1', 'Evidence from the Qurʾān', 0)
    await seedNote('nt_free', 'bk1', 'Scratch pad', 1)
    await libraryRepo.create({
      parentId: null,
      type: 'chapter',
      title: 'Chapter 3',
      arabicTitle: 'باب الخوف من الشرك',
      noteId: 'nt_ch',
    })
    act(() => useStudyStore.setState({ bookId: 'bk1', activeNoteId: 'nt_ch' }))

    render(<NotesPanel />)

    await waitFor(() => {
      const tabs = document.body.querySelectorAll('.notes-tab')
      expect(tabs.length).toBe(2)
    })

    const tabs = Array.from(document.body.querySelectorAll('.notes-tab'))
    const owned = tabs.find((t) => t.textContent?.includes('Chapter 3'))
    const free = tabs.find((t) => t.textContent?.includes('Scratch pad'))

    expect(owned).toBeTruthy()
    expect(owned!.textContent).toContain('Chapter 3')
    expect(owned!.textContent).toContain('باب الخوف من الشرك')
    expect(owned!.textContent).not.toContain('Evidence from the Qurʾān')
    // Mixed title keeps Latin, dash and Arabic as separate bdi/sep pieces.
    expect(owned!.querySelector('.lib-title-latin')?.textContent).toBe('Chapter 3')
    expect(owned!.querySelector('.lib-title-sep')?.textContent).toBe('—')
    expect(owned!.querySelector('.lib-title-arabic')?.textContent).toBe('باب الخوف من الشرك')

    expect(free).toBeTruthy()
    expect(free!.textContent).toBe('Scratch pad')
  })

  it('keeps a standalone note tab on note.title', async () => {
    await seedBook('bk1')
    await seedNote('nt_a', 'bk1', 'Weekly timetable', 0)
    await seedNote('nt_b', 'bk1', 'Questions for Ustādh', 1)
    act(() => useStudyStore.setState({ bookId: 'bk1', activeNoteId: 'nt_a' }))

    render(<NotesPanel />)
    await waitFor(() => expect(document.body.querySelectorAll('.notes-tab').length).toBe(2))

    const labels = Array.from(document.body.querySelectorAll('.notes-tab')).map((t) => t.textContent)
    expect(labels).toContain('Weekly timetable')
    expect(labels).toContain('Questions for Ustādh')
  })
})
