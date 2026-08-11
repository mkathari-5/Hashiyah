import { db } from '@/db/db'
import type { Annotation, AnnotationAnchor } from '@/types'

/**
 * Reads and writes only. All *policy* (how an anchor is built, what happens to
 * quote refs) lives in AnnotationEngine — this layer is deliberately dumb.
 */
export const annotationsRepo = {
  get: (id: string) => db.annotations.get(id),
  getMany: (idsList: string[]) => db.annotations.bulkGet(idsList),

  forPage: (documentId: string, pageNumber: number) =>
    db.annotations.where('[documentId+pageNumber]').equals([documentId, pageNumber]).toArray(),

  forDocument: (documentId: string) => db.annotations.where('documentId').equals(documentId).toArray(),
  forBook: (bookId: string) => db.annotations.where('bookId').equals(bookId).toArray(),

  async create(annotation: Annotation, anchor: AnnotationAnchor) {
    // One transaction: an annotation without its anchor must never exist.
    await db.transaction('rw', db.annotations, db.anchors, async () => {
      await db.annotations.add(annotation)
      await db.anchors.add(anchor)
    })
  },

  update: (id: string, patch: Partial<Annotation>) =>
    db.annotations.update(id, { ...patch, updatedAt: Date.now() }),

  async remove(id: string) {
    await db.transaction('rw', db.annotations, db.anchors, db.quoteRefs, async () => {
      await db.anchors.where('annotationId').equals(id).delete()
      await db.quoteRefs.where('annotationId').equals(id).delete()
      await db.annotations.delete(id)
    })
  },
}

export const anchorsRepo = {
  forAnnotation: (annotationId: string) => db.anchors.where('annotationId').equals(annotationId).first(),
  forPage: (documentId: string, pageNumber: number) =>
    db.anchors.where('[documentId+pageNumber]').equals([documentId, pageNumber]).toArray(),
  put: (anchor: AnnotationAnchor) => db.anchors.put(anchor),
}
