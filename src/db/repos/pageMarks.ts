import { db } from '@/db/db'
import type { OcrResult, PageMark } from '@/types'

export const pageMarksRepo = {
  get: (id: string) => db.pageMarks.get(id),
  forPage: (documentId: string, pageNumber: number) =>
    db.pageMarks.where('[documentId+pageNumber]').equals([documentId, pageNumber]).toArray(),
  forDocument: (documentId: string) => db.pageMarks.where('documentId').equals(documentId).toArray(),
  put: (mark: PageMark) => db.pageMarks.put(mark),
  remove: (id: string) => db.pageMarks.delete(id),
}

export const ocrResultsRepo = {
  get: (id: string) => db.ocrResults.get(id),
  put: (row: OcrResult) => db.ocrResults.put(row),
  forPage: (documentId: string, pageNumber: number) =>
    db.ocrResults.where('[documentId+pageNumber]').equals([documentId, pageNumber]).toArray(),
}
