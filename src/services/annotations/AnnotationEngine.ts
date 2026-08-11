import { annotationsRepo, anchorsRepo } from '@/db/repos/annotations'
import { pagesRepo } from '@/db/repos/documents'
import { notesRepo, quoteRefsRepo } from '@/db/repos/notes'
import { normalizeForSearch } from '@/lib/arabic'
import { ids } from '@/lib/id'
import { resolveAnchor } from '@/services/annotations/AnchorResolver'
import { KIND_META } from '@/services/annotations/kinds'
import type { CapturedSelection } from '@/services/annotations/selection'
import {
  ANCHOR_VERSION,
  type AnchorResolution,
  type Annotation,
  type AnnotationAnchor,
  type AnnotationKind,
  type HighlightColor,
  type Note,
  type TextSource,
} from '@/types'

/**
 * AnnotationEngine — the only thing in the application allowed to write
 * annotations or anchors.
 *
 * Keeping this single-writer is what makes the rest tractable: the highlight
 * layer, the notes editor and the search index all *read*, and every mutation
 * goes through here where the annotation and its anchor are written in one
 * transaction and the derived indexes stay consistent.
 */

export interface CreateAnnotationInput {
  bookId: string
  documentId: string
  capture: CapturedSelection
  kind: AnnotationKind
  color?: HighlightColor
  textSource?: TextSource
}

export interface AnnotationWithAnchor {
  annotation: Annotation
  anchor: AnnotationAnchor
}

/** How far either side of the recorded page the resolver may look. */
const NEIGHBOUR_RADIUS = 2

export const AnnotationEngine = {
  async create(input: CreateAnnotationInput): Promise<AnnotationWithAnchor> {
    const now = Date.now()
    const { capture } = input
    const annotationId = ids.annotation()

    const annotation: Annotation = {
      id: annotationId,
      bookId: input.bookId,
      documentId: input.documentId,
      pageNumber: capture.pageNumber,
      kind: input.kind,
      color: input.color ?? KIND_META[input.kind].color,
      selectedText: capture.text,
      normalizedText: normalizeForSearch(capture.text),
      textSource: input.textSource ?? 'embedded',
      layerId: null,
      lessonId: null,
      createdAt: now,
      updatedAt: now,
    }

    const anchor: AnnotationAnchor = {
      id: ids.anchor(),
      annotationId,
      documentId: input.documentId,
      pageNumber: capture.pageNumber,
      startOffset: capture.startOffset,
      endOffset: capture.endOffset,
      itemStart: capture.itemStart,
      itemEnd: capture.itemEnd,
      occurrenceIndex: capture.occurrenceIndex,
      textBefore: capture.textBefore,
      textAfter: capture.textAfter,
      rects: capture.rects,
      pageWidth: capture.pageWidth,
      pageHeight: capture.pageHeight,
      pageRotation: capture.pageRotation,
      anchorVersion: ANCHOR_VERSION,
    }

    await annotationsRepo.create(annotation, anchor)
    return { annotation, anchor }
  },

  get: (id: string) => annotationsRepo.get(id),

  forPage: (documentId: string, pageNumber: number) => annotationsRepo.forPage(documentId, pageNumber),

  forDocument: (documentId: string) => annotationsRepo.forDocument(documentId),

  update: (id: string, patch: Partial<Annotation>) => annotationsRepo.update(id, patch),

  remove: (id: string) => annotationsRepo.remove(id),

  /**
   * Where does this annotation point right now? Loads the anchor plus a small
   * window of pages and hands them to the (pure) resolver.
   */
  async resolve(annotationId: string): Promise<
    (AnnotationWithAnchor & { resolution: AnchorResolution }) | null
  > {
    const annotation = await annotationsRepo.get(annotationId)
    if (!annotation) return null
    const anchor = await anchorsRepo.forAnnotation(annotationId)
    if (!anchor) return null

    const pages = await pagesRepo.window(anchor.documentId, anchor.pageNumber, NEIGHBOUR_RADIUS)
    const resolution = resolveAnchor(anchor, annotation.selectedText, pages)
    return { annotation, anchor, resolution }
  },

  /** Resolve many at once — used when rendering a page full of highlights. */
  async resolveForPage(documentId: string, pageNumber: number) {
    const [annotations, anchors, pages] = await Promise.all([
      annotationsRepo.forPage(documentId, pageNumber),
      anchorsRepo.forPage(documentId, pageNumber),
      pagesRepo.window(documentId, pageNumber, NEIGHBOUR_RADIUS),
    ])
    const byAnnotation = new Map(anchors.map((a) => [a.annotationId, a]))
    return annotations.flatMap((annotation) => {
      const anchor = byAnnotation.get(annotation.id)
      if (!anchor) return []
      return [{ annotation, anchor, resolution: resolveAnchor(anchor, annotation.selectedText, pages) }]
    })
  },

  /** The passage → notes direction of the bidirectional link. */
  async notesFor(annotationId: string): Promise<Note[]> {
    const refs = await quoteRefsRepo.forAnnotation(annotationId)
    const notes = await Promise.all(refs.map((r) => notesRepo.get(r.noteId)))
    const seen = new Set<string>()
    return notes.filter((n): n is Note => {
      if (!n || seen.has(n.id)) return false
      seen.add(n.id)
      return true
    })
  },

  /** Annotation ids on this page that at least one note quotes. */
  async annotatedIdsWithNotes(annotationIds: string[]): Promise<Set<string>> {
    if (annotationIds.length === 0) return new Set()
    const refs = await quoteRefsRepo.forAnnotations(annotationIds)
    return new Set(refs.map((r) => r.annotationId))
  },
}
