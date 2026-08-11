import { create } from 'zustand'
import { booksRepo } from '@/db/repos/library'
import { documentsRepo } from '@/db/repos/documents'
import { notesRepo } from '@/db/repos/notes'
import { readingStateRepo } from '@/db/repos/session'
import type { CapturedSelection } from '@/services/annotations/selection'

/**
 * The state of *studying* — which book is open, where in it we are, what is
 * selected, and the two cross-panel intents (jump to a source, reveal a note).
 *
 * Those two intents are modelled as one-shot "requests" carrying a nonce rather
 * than as booleans, so asking twice for the same target still fires twice.
 */

/** 'capture' inserts the region; 'explain' also drops a paragraph beneath (§D10). */
export type SnipMode = null | 'capture' | 'explain'

export interface JumpRequest {
  annotationId: string
  nonce: number
}

export interface RevealRequest {
  noteId: string
  annotationId: string
  nonce: number
}

export interface LiveSelection {
  capture: CapturedSelection
  documentId: string
  bookId: string
  /** Viewport-space anchor for the floating menu. */
  menuLeft: number
  menuTop: number
}

interface StudyState {
  bookId: string | null
  documentId: string | null
  pageCount: number
  currentPage: number
  zoom: number
  /** null = fit width, recomputed on resize. */
  fitMode: 'width' | 'page' | 'custom'
  activeNoteId: string | null
  selection: LiveSelection | null
  activeAnnotationId: string | null
  jumpRequest: JumpRequest | null
  revealRequest: RevealRequest | null
  restoredScrollRatio: number | null
  lessonStartedAt: number | null
  /** null = normal reading; otherwise the reader is dragging out a capture. */
  snipMode: SnipMode

  openBook: (bookId: string) => Promise<void>
  closeBook: () => void
  setPage: (page: number) => void
  setPageCount: (count: number) => void
  setZoom: (zoom: number) => void
  setFitMode: (mode: 'width' | 'page' | 'custom') => void
  setActiveNote: (noteId: string | null) => void
  setSelection: (selection: LiveSelection | null) => void
  setActiveAnnotation: (id: string | null) => void
  requestJump: (annotationId: string) => void
  requestReveal: (noteId: string, annotationId: string) => void
  clearRestoredScroll: () => void
  persistPosition: (scrollRatio: number) => void
  startLessonTimer: () => void
  stopLessonTimer: () => void
  setSnipMode: (mode: SnipMode) => void
}

let nonce = 0

export const useStudyStore = create<StudyState>((set, get) => ({
  bookId: null,
  documentId: null,
  pageCount: 0,
  currentPage: 1,
  zoom: 1,
  fitMode: 'width',
  activeNoteId: null,
  selection: null,
  activeAnnotationId: null,
  jumpRequest: null,
  revealRequest: null,
  restoredScrollRatio: null,
  lessonStartedAt: null,
  snipMode: null,

  async openBook(bookId) {
    if (get().bookId === bookId) return
    const [book, docs, state, notes] = await Promise.all([
      booksRepo.get(bookId),
      documentsRepo.forBook(bookId),
      readingStateRepo.get(bookId),
      notesRepo.forBook(bookId),
    ])
    if (!book) return

    // §52 — reopening restores the study environment, not just the book.
    const activeNoteId =
      (state?.activeNoteId && notes.some((n) => n.id === state.activeNoteId)
        ? state.activeNoteId
        : notes[0]?.id) ?? null

    set({
      bookId,
      documentId: docs[0]?.id ?? null,
      pageCount: book.pageCount,
      currentPage: state?.pageNumber ?? 1,
      zoom: state?.zoom ?? 1,
      fitMode: state?.zoom ? 'custom' : 'width',
      activeNoteId,
      restoredScrollRatio: state?.scrollRatio ?? 0,
      selection: null,
      activeAnnotationId: null,
    })
    void booksRepo.touch(bookId)
  },

  closeBook: () =>
    set({
      bookId: null,
      documentId: null,
      pageCount: 0,
      currentPage: 1,
      activeNoteId: null,
      selection: null,
      activeAnnotationId: null,
      restoredScrollRatio: null,
    }),

  setPage(page) {
    if (get().currentPage === page) return
    set({ currentPage: page })
  },

  setPageCount: (pageCount) => set({ pageCount }),
  setZoom: (zoom) => set({ zoom, fitMode: 'custom' }),
  setFitMode: (fitMode) => set({ fitMode }),
  setActiveNote(noteId) {
    set({ activeNoteId: noteId })
    const { bookId } = get()
    if (bookId) void get().persistPosition(-1)
  },
  setSelection: (selection) => set({ selection }),
  setActiveAnnotation: (activeAnnotationId) => set({ activeAnnotationId }),

  requestJump: (annotationId) => set({ jumpRequest: { annotationId, nonce: ++nonce } }),
  requestReveal: (noteId, annotationId) =>
    set({ revealRequest: { noteId, annotationId, nonce: ++nonce } }),

  clearRestoredScroll: () => set({ restoredScrollRatio: null }),

  persistPosition(scrollRatio) {
    const { bookId, currentPage, zoom, activeNoteId } = get()
    if (!bookId) return
    void readingStateRepo.put({
      bookId,
      pageNumber: currentPage,
      // -1 means "keep whatever ratio is already stored" (used when only the
      // active note changed).
      scrollRatio: scrollRatio < 0 ? (get().restoredScrollRatio ?? 0) : scrollRatio,
      zoom,
      activeNoteId,
    })
  },

  startLessonTimer: () => set({ lessonStartedAt: Date.now() }),
  stopLessonTimer: () => set({ lessonStartedAt: null }),
  // Entering capture mode always clears any live text selection: the two are
  // different ways of pointing at the page and should never be active at once.
  setSnipMode: (snipMode) => set({ snipMode, selection: snipMode ? null : get().selection }),
}))
