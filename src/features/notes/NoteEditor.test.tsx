import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import { NoteEditor } from '@/features/notes/NoteEditor'
import { collectToggleStates } from '@/services/notes/NotesService'
import { isRevising, useNotesStore } from '@/state/useNotesStore'
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

/**
 * The study session as the app actually runs it.
 *
 * Two remounts are modelled, because both are real: the notes panel keys the
 * editor by note, and the shell keys the whole panel group by layout mode, so
 * Ctrl+3 tears this subtree down and builds it again.
 */
function Study({ layout = 'three' }: { layout?: string }) {
  const activeNoteId = useStudyStore((s) => s.activeNoteId)
  return (
    <div key={layout}>{activeNoteId ? <NoteEditor key={activeNoteId} noteId={activeNoteId} /> : null}</div>
  )
}

const toggles = () => Array.from(document.querySelectorAll<HTMLElement>('[data-toggle]'))
const openState = () =>
  Object.fromEntries(toggles().map((el) => [el.dataset.blockId, el.dataset.open === 'true']))

const savedStates = async (noteId: string) =>
  collectToggleStates((await db.noteDocs.get(noteId))?.doc)

const revising = (noteId: string) => isRevising(useNotesStore.getState(), noteId)

/** Enter revision the way the panel's button does: for a named note. */
const enterRevision = (noteId: string) =>
  act(() => useNotesStore.getState().setRevisionMode(noteId, true))
const exitRevision = (noteId: string) =>
  act(() => useNotesStore.getState().setRevisionMode(noteId, false))

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
  useNotesStore.setState({ revision: null })
  useStudyStore.setState({ activeNoteId: null, bookId: null, documentId: null })
  await seedChapter('nt_3', 'Chapter 3', CHAPTER_3)
  await seedChapter('nt_4', 'Chapter 4', CHAPTER_4)
})

describe('revision mode', () => {
  it('collapses every section on entry, whatever the reader had open', async () => {
    useStudyStore.setState({ activeNoteId: 'nt_3' })
    render(<Study />)
    await waitFor(() => expect(openState()).toEqual({ a: true, b: false, c: true }))

    enterRevision('nt_3')

    await waitFor(() => expect(openState()).toEqual({ a: false, b: false, c: false }))
  })

  it('never lets the temporary collapse become the saved state', async () => {
    useStudyStore.setState({ activeNoteId: 'nt_3' })
    render(<Study />)
    await waitFor(() => expect(openState()).toEqual({ a: true, b: false, c: true }))

    enterRevision('nt_3')
    await waitFor(() => expect(openState()).toEqual({ a: false, b: false, c: false }))

    // Long enough for the autosave the collapse itself triggers to land.
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(await savedStates('nt_3')).toEqual({ a: true, b: false, c: true })
  })

  it('restores the chapter and leaves revision when the reader exits', async () => {
    useStudyStore.setState({ activeNoteId: 'nt_3' })
    render(<Study />)
    await waitFor(() => expect(openState()).toEqual({ a: true, b: false, c: true }))

    enterRevision('nt_3')
    await waitFor(() => expect(openState()).toEqual({ a: false, b: false, c: false }))

    exitRevision('nt_3')

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

      enterRevision('nt_3')
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

      expect(revising('nt_4')).toBe(false)
      expect(revising('nt_3')).toBe(false)
      // The session is gone, not merely ignored.
      expect(useNotesStore.getState().revision).toBeNull()
      expect(openState()).toEqual({ d: true, e: true })
    })

    it('does not carry the previous chapter’s snapshot into the new one', async () => {
      await reviseThenLeave()

      // Revising Chapter 4 must record Chapter 4 — if Chapter 3's session had
      // travelled, leaving revision here would apply states for blocks this
      // document has never had.
      expect(useNotesStore.getState().revision).toBeNull()

      enterRevision('nt_4')
      await waitFor(() => expect(openState()).toEqual({ d: false, e: false }))
      expect(useNotesStore.getState().revision?.originalToggleStates).toEqual({ d: true, e: true })

      exitRevision('nt_4')
      await waitFor(() => expect(openState()).toEqual({ d: true, e: true }))
      await waitFor(async () => expect(await savedStates('nt_4')).toEqual({ d: true, e: true }))
    })

    it('shows the chapter exactly as it was when the reader returns to it', async () => {
      await reviseThenLeave()

      await act(async () => {
        useStudyStore.getState().setActiveNote('nt_3')
      })

      await waitFor(() => expect(openState()).toEqual({ a: true, b: false, c: true }))
      expect(revising('nt_3')).toBe(false)
    })
  })

  /**
   * Ctrl+3 and its friends rebuild the panel group, which rebuilds this
   * editor. That is a change of *view*, not of chapter: the reader is still
   * revising the same bāb and has not asked to stop.
   */
  describe('across a layout change', () => {
    async function reviseThenChangeLayout() {
      useStudyStore.setState({ activeNoteId: 'nt_3' })
      const view = render(<Study layout="three" />)
      await waitFor(() => expect(openState()).toEqual({ a: true, b: false, c: true }))

      enterRevision('nt_3')
      await waitFor(() => expect(openState()).toEqual({ a: false, b: false, c: false }))

      // Focus the notes: the shell keys the panel group by layout, so this
      // unmounts and remounts the editor on the very same note.
      await act(async () => {
        view.rerender(<Study layout="notes" />)
      })
      await waitFor(() => expect(Object.keys(openState())).toEqual(['a', 'b', 'c']))
      return view
    }

    it('is still revising the same chapter afterwards', async () => {
      await reviseThenChangeLayout()

      expect(revising('nt_3')).toBe(true)
      await waitFor(() => expect(openState()).toEqual({ a: false, b: false, c: false }))
    })

    it('keeps the states it recorded on entry rather than re-reading a collapsed document', async () => {
      await reviseThenChangeLayout()

      // The trap: re-snapshotting after the remount would record the flattened
      // view, and exiting would then "restore" everything closed.
      expect(useNotesStore.getState().revision?.originalToggleStates).toEqual({
        a: true,
        b: false,
        c: true,
      })
    })

    it('can still reveal a section after the layout change', async () => {
      await reviseThenChangeLayout()

      const arrow = toggles().find((el) => el.dataset.blockId === 'b')!.querySelector('button')!
      act(() => arrow.click())

      await waitFor(() => expect(openState()).toEqual({ a: false, b: true, c: false }))
      // And revealing it still does not edit the chapter.
      await new Promise((resolve) => setTimeout(resolve, 600))
      expect(await savedStates('nt_3')).toEqual({ a: true, b: false, c: true })
    })

    it('restores the reader’s own sections exactly when they finally exit', async () => {
      const view = await reviseThenChangeLayout()

      // Back to the three-panel layout first: two remounts, one session.
      await act(async () => {
        view.rerender(<Study layout="three" />)
      })
      await waitFor(() => expect(openState()).toEqual({ a: false, b: false, c: false }))
      expect(revising('nt_3')).toBe(true)

      exitRevision('nt_3')

      await waitFor(() => expect(openState()).toEqual({ a: true, b: false, c: true }))
      await waitFor(async () => expect(await savedStates('nt_3')).toEqual({ a: true, b: false, c: true }))
      expect(useNotesStore.getState().revision).toBeNull()
    })

    it('never persists the collapse at any point along the way', async () => {
      const view = await reviseThenChangeLayout()
      expect(await savedStates('nt_3')).toEqual({ a: true, b: false, c: true })

      await act(async () => {
        view.rerender(<Study layout="three" />)
      })
      await waitFor(() => expect(openState()).toEqual({ a: false, b: false, c: false }))

      // Every save between here and the end of the session — autosave, blur,
      // the flush each remount performs — writes the reader's own states.
      await new Promise((resolve) => setTimeout(resolve, 600))
      expect(await savedStates('nt_3')).toEqual({ a: true, b: false, c: true })
    })

    it('still ends revision when the chapter changes after a layout change', async () => {
      await reviseThenChangeLayout()

      await act(async () => {
        useStudyStore.getState().setActiveNote('nt_4')
      })
      await waitFor(() => expect(Object.keys(openState())).toEqual(['d', 'e']))

      expect(useNotesStore.getState().revision).toBeNull()
      expect(openState()).toEqual({ d: true, e: true })
      await waitFor(async () => expect(await savedStates('nt_3')).toEqual({ a: true, b: false, c: true }))
    })
  })

  it('keeps a section the reader revealed during revision out of the saved chapter', async () => {
    useStudyStore.setState({ activeNoteId: 'nt_3' })
    render(<Study />)
    await waitFor(() => expect(openState()).toEqual({ a: true, b: false, c: true }))

    enterRevision('nt_3')
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
