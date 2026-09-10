import { db } from '@/db/db'
import type { PdfNoteLink } from '@/types'

export const pdfNoteLinksRepo = {
  get: (id: string) => db.pdfNoteLinks.get(id),

  put: (link: PdfNoteLink) => db.pdfNoteLinks.put(link),

  putMany: (links: PdfNoteLink[]) => db.pdfNoteLinks.bulkPut(links),

  remove: (id: string) => db.pdfNoteLinks.delete(id),

  forPage: (pdfDocumentId: string, pageNumber: number) =>
    db.pdfNoteLinks.where('[pdfDocumentId+pageNumber]').equals([pdfDocumentId, pageNumber]).toArray(),

  forDocument: (pdfDocumentId: string) =>
    db.pdfNoteLinks.where('pdfDocumentId').equals(pdfDocumentId).toArray(),

  forNote: (noteDocumentId: string) =>
    db.pdfNoteLinks.where('noteDocumentId').equals(noteDocumentId).toArray(),

  forBlock: (noteDocumentId: string, noteBlockId: string) =>
    db.pdfNoteLinks.where('[noteDocumentId+noteBlockId]').equals([noteDocumentId, noteBlockId]).toArray(),

  forAnnotation: (annotationId: string) =>
    db.pdfNoteLinks.where('annotationId').equals(annotationId).toArray(),

  forBlocks: (noteDocumentId: string, noteBlockIds: string[]) =>
    db.pdfNoteLinks
      .where('noteDocumentId')
      .equals(noteDocumentId)
      .filter((link) => noteBlockIds.includes(link.noteBlockId))
      .toArray(),
}
