import { booksRepo } from '@/db/repos/library'
import { notesRepo } from '@/db/repos/notes'
import { AnnotationEngine } from '@/services/annotations/AnnotationEngine'
import { KIND_META } from '@/services/annotations/kinds'
import { capturePdfRegion } from '@/services/pdf/capture'
import type { PDFDocumentProxy } from '@/services/pdf/pdfjs'
import { useNotesStore, type InsertShape } from '@/state/useNotesStore'
import { useStudyStore, type LiveSelection } from '@/state/useStudyStore'
import type { AnnotationKind, NormalizedRect } from '@/types'

/**
 * Everything that moves content from the book into the notes (§D3–§D5, §D10).
 *
 * The whole operation is: create the source record, hand its id to the editor,
 * get out of the way. No dialog, no confirmation, no "choose a note" step.
 * Every decision that can be made for the reader is made for them.
 */

/** Makes sure there is somewhere to write, creating the book's first note if not. */
async function ensureActiveNote(bookId: string): Promise<string> {
  const study = useStudyStore.getState()
  if (study.activeNoteId) return study.activeNoteId
  const book = await booksRepo.get(bookId)
  const note = await notesRepo.create({
    bookId,
    title: book?.title ? `${book.title} — notes` : 'Notes',
  })
  study.setActiveNote(note.id)
  return note.id
}

function shapeFor(kind: AnnotationKind): { shape: InsertShape; blockKind: string | null } {
  if (kind === 'highlight') return { shape: 'quote', blockKind: null }
  const block = KIND_META[kind].block
  return block ? { shape: 'semantic', blockKind: block } : { shape: 'explain', blockKind: null }
}

/**
 * Extract & Explain and its siblings (§D4, §D5).
 *
 * `explain` gives a passage plus an empty paragraph; `benefit`, `definition`,
 * `teacher`, `evidence` and `question` give a passage plus that named study
 * block. In every case the cursor lands ready to type.
 */
export async function extractAndExplain(kind: AnnotationKind, selection: LiveSelection): Promise<void> {
  const study = useStudyStore.getState()

  const { annotation } = await AnnotationEngine.create({
    bookId: selection.bookId,
    documentId: selection.documentId,
    capture: selection.capture,
    kind,
  })

  // A plain highlight is a mark on the book, not a note about it.
  if (kind !== 'highlight') {
    await ensureActiveNote(selection.bookId)
    const { shape, blockKind } = shapeFor(kind)
    useNotesStore.getState().requestInsert({
      shape,
      annotationId: annotation.id,
      blockKind,
      assetId: null,
      withExplanation: false,
    })
  }

  study.setSelection(null)
  window.getSelection()?.removeAllRanges()
}

/**
 * Send to Notes (§D3) — the passage and nothing else.
 *
 * Deliberately distinct from Explain: sometimes you only want the quotation,
 * and being dropped into an empty paragraph you did not ask for is friction.
 * The cursor stays where it was.
 */
export async function sendToNotes(selection: LiveSelection): Promise<void> {
  const study = useStudyStore.getState()

  const { annotation } = await AnnotationEngine.create({
    bookId: selection.bookId,
    documentId: selection.documentId,
    capture: selection.capture,
    kind: 'reference',
  })

  await ensureActiveNote(selection.bookId)
  useNotesStore.getState().requestInsert({
    shape: 'quote',
    annotationId: annotation.id,
    blockKind: null,
    assetId: null,
    withExplanation: false,
  })

  study.setSelection(null)
  window.getSelection()?.removeAllRanges()
}

/** Plain clipboard copy of exactly what was selected (§D1, Copy action). */
export async function copySelection(selection: LiveSelection): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(selection.capture.text)
    return true
  } catch {
    return false
  }
}

/**
 * §72 / §D10 — a note pinned to the current reading position, with no text
 * selected. Anchors to the page rather than to a passage.
 */
export async function quickNoteAtCurrentPosition(): Promise<void> {
  const study = useStudyStore.getState()
  if (!study.bookId || !study.documentId) return

  const { annotation } = await AnnotationEngine.create({
    bookId: study.bookId,
    documentId: study.documentId,
    kind: 'reference',
    capture: {
      pageNumber: study.currentPage,
      text: '',
      startOffset: 0,
      endOffset: 0,
      itemStart: 0,
      itemEnd: 0,
      textBefore: '',
      textAfter: '',
      occurrenceIndex: 0,
      rects: [],
      pageWidth: 0,
      pageHeight: 0,
      pageRotation: 0,
    },
  })

  await ensureActiveNote(study.bookId)
  useNotesStore.getState().requestInsert({
    shape: 'explain',
    annotationId: annotation.id,
    blockKind: null,
    assetId: null,
    withExplanation: false,
  })
}

/**
 * Snip → notes (§D9–§D12).
 *
 * The captured region becomes both an image asset *and* a source annotation,
 * so the screenshot can point back at the exact rectangle it came from just as
 * a quotation points back at its sentence.
 */
export async function captureRegionToNotes(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  rect: NormalizedRect,
  options: { withExplanation: boolean },
): Promise<boolean> {
  const study = useStudyStore.getState()
  if (!study.bookId || !study.documentId) return false

  const captured = await capturePdfRegion(pdf, pageNumber, rect)
  if (!captured) return false

  const { annotation } = await AnnotationEngine.create({
    bookId: study.bookId,
    documentId: study.documentId,
    kind: 'capture',
    capture: {
      pageNumber,
      text: '',
      startOffset: 0,
      endOffset: 0,
      itemStart: 0,
      itemEnd: 0,
      textBefore: '',
      textAfter: '',
      occurrenceIndex: 0,
      // The rectangle *is* the anchor for a captured region.
      rects: [rect],
      pageWidth: captured.width,
      pageHeight: captured.height,
      pageRotation: 0,
    },
  })

  await ensureActiveNote(study.bookId)
  useNotesStore.getState().requestInsert({
    shape: 'image',
    annotationId: annotation.id,
    blockKind: null,
    assetId: captured.assetId,
    withExplanation: options.withExplanation,
  })
  return true
}
