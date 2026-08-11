import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import { NoteEditor } from '@/features/notes/NoteEditor'
import { collectToggleStates } from '@/services/notes/NotesService'
import { useNotesStore } from '@/state/useNotesStore'
import { useStudyStore } from '@/state/useStudyStore'

/**
 * Revision mode across a chapter switch (§E30).
 *
 * Revision is a way of *reading* a chapter: it collapses everything, the reader
 * works through it, and the sections they actually had open come back. The
 * failure this file guards against is that temporary collapse becoming the
 * chapter's real, saved state — which is what happens if the reader clicks
 * another chapter instead of pressing Exit.
 */

const toggle = (title: string, blockId: string, open: boolean) => ({
  type: 'toggleBlock',
  attrs: { blockId, open, level: 0 },
  content: [
    { type: 'toggleSummary', content: [{ type: 'text', text: title }] },
    { type: 'toggleContent', content: [{ type: 'paragraph', attrs: { blockId: `${blockId}_p` } }] },
  ],
})

/** Chapter 3 as the reader left it: A open, B closed, C open. */
const CHAPTER_3 = {
  type: 'doc',
  content: [
    toggle('Reason for this Chapter?', 'a', true),
    toggle('First Āyah used as Evidence', 'b', false),
    toggle('What is الرياء?', 'c', true),
  ],
}

const CHAPTER_4 = {
  type: 'doc',
  content: [toggle('Meaning of الاعتصام', 'd', true), toggle('Benefits', 'e', true)],
}

async function seedChapter(noteId: string, title: string, doc: unknown) {
  const node = await libraryRepo.create({ parentId: null, type: 'chapter', title, noteId })
  await db.notes.add({
    id: noteId,
    bookId: null,
    title,
    outlineNodeId: null,
    lessonId: null,
    layerId: null,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  })
  await db.noteDocs.put({ noteId, doc, updatedAt: 1 })
  return node
}

/** The study session as the notes panel runs it: one editor per active note. */
function Study() {
  const activeNoteId = useStudyStore((s) => s.activeNoteId)
  return activeNoteId ? <NoteEditor key={activeNoteId} noteId={activeNoteId} /> : null
}

const toggles = () => Array.from(document.querySelectorAll<HTMLElement>('[data-toggle]'))
const openState = () =>
  Object.fromEntries(toggles().map((el) => [el.dataset.blockId, el.dataset.open === 'true']))

const savedStates = async (noteId: string) =>
  collectToggleStates((await db.noteDocs.get(noteId))?.doc)

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
  useNotesStore.setState({ revisionMode: false })
  useStudyStore.setState({ activeNoteId: null, bookId: null, documentId: null })
  await seedChapter('nt_3', 'Chapter 3', CHAPTER_3)
  await seedChapter('nt_4', 'Chapter 4', CHAPTER_4)
})

describe('revision mode', () => {
  it('collapses every section on entry, whatever the reader had open', async () => {
    useStudyStore.setState({ activeNoteId: 'nt_3' })
    render(<Study />)
    await waitFor(() => expect(openState()).toEqual({ a: true, b: false, c: true }))

    act(() => useNotesStore.getState().setRevisionMode(true))

    await waitFor(() => expect(openState()).toEqual({ a: false, b: false, c: false }))
  })

  it('never lets the temporary collapse become the saved state', async () => {
    useStudyStore.setState({ activeNoteId: 'nt_3' })
    render(<Study />)
    await waitFor(() => expect(openState()).toEqual({ a: true, b: false, c: true }))

    act(() => useNotesStore.getState().setRevisionMode(true))
    await waitFor(() => expect(openState()).toEqual({ a: false, b: false, c: false }))

    // Long enough for the autosave the collapse itself triggers to land.
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(await savedStates('nt_3')).toEqual({ a: true, b: false, c: true })
  })

  it('restores the chapter and leaves revision when the reader exits', async () => {
    useStudyStore.setState({ activeNoteId: 'nt_3' })
    render(<Study />)
    await waitFor(() => expect(openState()).toEqual({ a: true, b: false, c: true }))

    act(() => useNotesStore.getState().setRevisionMode(true))
    await waitFor(() => expect(openState()).toEqual({ a: false, b: false, c: false }))

    act(() => useNotesStore.getState().setRevisionMode(false))

    await waitFor(() => expect(openState()).toEqual({ a: true, b: false, c: true }))
    await waitFor(async () => expect(await savedStates('nt_3')).toEqual({ a: true, b: false, c: true }))
  })

  /**
   * The sequence that matters: revise Chapter 3, click Chapter 4 without
   * pressing Exit, come back later.
   */
  describe('switching chapter mid-revision', () => {
    async function reviseThenLeave() {
      useStudyStore.setState({ activeNoteId: 'nt_3' })
      const view = render(<Study />)
      await waitFor(() => expect(openState()).toEqual({ a: true, b: false, c: true }))

      act(() => useNotesStore.getState().setRevisionMode(true))
      await waitFor(() => expect(openState()).toEqual({ a: false, b: false, c: false }))

      // No Exit — straight to the next chapter, as a reader would.
      await act(async () => {
        useStudyStore.getState().setActiveNote('nt_4')
      })
      await waitFor(() => expect(Object.keys(openState())).toEqual(['d', 'e']))
      return view
    }

    it('gives the chapter its own sections back', async () => {
      await reviseThenLeave()
      await waitFor(async () => expect(await savedStates('nt_3')).toEqual({ a: true, b: false, c: true }))
    })

    it('opens the new chapter normally rather than in revision', async () => {
      await reviseThenLeave()

      expect(useNotesStore.getState().revisionMode).toBe(false)
      expect(openState()).toEqual({ d: true, e: true })
    })

    it('does not carry the previous chapter’s snapshot into the new one', async () => {
      await reviseThenLeave()

      // Revising Chapter 4 must snapshot Chapter 4 — if Chapter 3's snapshot
      // had travelled, leaving revision here would apply states for blocks
      // this document has never had.
      act(() => useNotesStore.getState().setRevisionMode(true))
      await waitFor(() => expect(openState()).toEqual({ d: false, e: false }))

      act(() => useNotesStore.getState().setRevisionMode(false))
      await waitFor(() => expect(openState()).toEqual({ d: true, e: true }))
      await waitFor(async () => expect(await savedStates('nt_4')).toEqual({ d: true, e: true }))
    })

    it('shows the chapter exactly as it was when the reader returns to it', async () => {
      await reviseThenLeave()

      await act(async () => {
        useStudyStore.getState().setActiveNote('nt_3')
      })

      await waitFor(() => expect(openState()).toEqual({ a: true, b: false, c: true }))
      expect(useNotesStore.getState().revisionMode).toBe(false)
    })
  })

  it('keeps a section the reader revealed during revision out of the saved chapter', async () => {
    useStudyStore.setState({ activeNoteId: 'nt_3' })
    render(<Study />)
    await waitFor(() => expect(openState()).toEqual({ a: true, b: false, c: true }))

    act(() => useNotesStore.getState().setRevisionMode(true))
    await waitFor(() => expect(openState()).toEqual({ a: false, b: false, c: false }))

    // Reveal B — the whole point of revision — then leave without exiting.
    const arrow = toggles().find((el) => el.dataset.blockId === 'b')!.querySelector('button')!
    act(() => arrow.click())
    await waitFor(() => expect(openState()).toEqual({ a: false, b: true, c: false }))

    await act(async () => {
      useStudyStore.getState().setActiveNote('nt_4')
    })

    // B goes back to closed: revealing an answer is not editing the chapter.
    await waitFor(async () => expect(await savedStates('nt_3')).toEqual({ a: true, b: false, c: true }))
  })
})
