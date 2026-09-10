import { create } from 'zustand'
import { booksRepo } from '@/db/repos/library'
import { documentsRepo } from '@/db/repos/documents'
import { notesRepo } from '@/db/repos/notes'
import { readingStateRepo } from '@/db/repos/session'
import type { CapturedSelection } from '@/services/annotations/selection'
import type { HighlightColor, OcrLanguage, PdfNoteAnchorKind } from '@/types'

/** 'capture' inserts the region; 'explain' also drops a paragraph beneath (§D10); 'link' draws a PDF↔note region. */
export type SnipMode = null | 'capture' | 'explain' | 'link'

export type PdfTool = 'select' | 'pan' | 'text' | 'highlight' | 'underline' | 'erase'

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
  textSource?: 'embedded' | 'ocr' | 'none'
  anchorKind?: PdfNoteAnchorKind
  /** When set, the picker updates this link instead of creating a new one. */
  relinkId?: string
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
  pdfTool: PdfTool
  pageRotation: 0 | 90 | 180 | 270
  ocrLanguage: OcrLanguage
  selectedMarkId: string | null
  editingMarkId: string | null
  /** True while a mark is being dragged or resized — viewer pan must not run. */
  annotationGesture: boolean
  lastHighlightColor: HighlightColor
  lastUnderlineColor: HighlightColor
  selectedPdfNoteLinkId: string | null
  linkDraft: LiveSelection | null

  openBook: (bookId: string) => Promise<void>
  closeBook: () => void
  setPage: (page: number) => void
  setPageCount: (count: number) => void
  setDocumentId: (documentId: string | null) => void
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
  setPdfTool: (tool: PdfTool) => void
  setPageRotation: (rotation: 0 | 90 | 180 | 270) => void
  setOcrLanguage: (language: OcrLanguage) => void
  setSelectedMarkId: (id: string | null) => void
  setEditingMarkId: (id: string | null) => void
  setAnnotationGesture: (active: boolean) => void
  setLastHighlightColor: (color: HighlightColor) => void
  setLastUnderlineColor: (color: HighlightColor) => void
  setSelectedPdfNoteLinkId: (id: string | null) => void
  setLinkDraft: (draft: LiveSelection | null) => void
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
  pdfTool: 'select',
  pageRotation: 0,
  ocrLanguage: 'ara+eng',
  selectedMarkId: null,
  editingMarkId: null,
  annotationGesture: false,
  lastHighlightColor: 'yellow',
  lastUnderlineColor: 'ink',
  selectedPdfNoteLinkId: null,
  linkDraft: null,

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
      pdfTool: 'select',
      pageRotation: 0,
      selectedMarkId: null,
      editingMarkId: null,
      selectedPdfNoteLinkId: null,
      linkDraft: null,
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
      pdfTool: 'select',
      selectedMarkId: null,
      editingMarkId: null,
      selectedPdfNoteLinkId: null,
      linkDraft: null,
    }),

  setPage(page) {
    if (get().currentPage === page) return
    set({ currentPage: page })
  },

  setPageCount: (pageCount) => set({ pageCount }),
  setDocumentId: (documentId) => set({ documentId }),
  setZoom: (zoom) => set({ zoom, fitMode: 'custom' }),
  setFitMode: (fitMode) => set({ fitMode }),
  setActiveNote(noteId) {
    set({ activeNoteId: noteId })
    const { bookId } = get()
    if (!bookId || !noteId) {
      if (bookId) void get().persistPosition(-1)
      return
    }
    void notesRepo.get(noteId).then((note) => {
      if (note?.bookId === bookId) void get().persistPosition(-1)
    })
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
  setPdfTool: (pdfTool) =>
    set({
      pdfTool,
      snipMode: null,
      selectedMarkId:
        pdfTool === 'select' || pdfTool === 'text' || pdfTool === 'erase' ? get().selectedMarkId : null,
      editingMarkId: pdfTool === 'text' ? get().editingMarkId : null,
      annotationGesture: false,
    }),
  setPageRotation: (pageRotation) => set({ pageRotation }),
  setOcrLanguage: (ocrLanguage) => set({ ocrLanguage }),
  setSelectedMarkId: (selectedMarkId) => set({ selectedMarkId, activeAnnotationId: selectedMarkId ? null : get().activeAnnotationId }),
  setEditingMarkId: (editingMarkId) => set({ editingMarkId }),
  setAnnotationGesture: (annotationGesture) => set({ annotationGesture }),
  setLastHighlightColor: (lastHighlightColor) => set({ lastHighlightColor }),
  setLastUnderlineColor: (lastUnderlineColor) => set({ lastUnderlineColor }),
  setSelectedPdfNoteLinkId: (selectedPdfNoteLinkId) =>
    set({ selectedPdfNoteLinkId, selectedMarkId: selectedPdfNoteLinkId ? null : get().selectedMarkId }),
  setLinkDraft: (linkDraft) => set({ linkDraft }),
}))
