import { db } from '@/db/db'
import { pageId } from '@/lib/id'
import type { DocumentMeta, OutlineNode, PageRecord } from '@/types'

export const documentsRepo = {
  get: (id: string) => db.documents.get(id),
  forBook: (bookId: string) => db.documents.where('bookId').equals(bookId).toArray(),
  byFingerprint: (fingerprint: string) => db.documents.where('fingerprint').equals(fingerprint).first(),

  async add(meta: DocumentMeta, blob: Blob) {
    await db.transaction('rw', db.documents, db.documentBlobs, async () => {
      await db.documents.add(meta)
      await db.documentBlobs.put({ documentId: meta.id, blob })
    })
  },

  async blob(documentId: string): Promise<Blob | null> {
    const row = await db.documentBlobs.get(documentId)
    return row?.blob ?? null
  },
}

export const pagesRepo = {
  get: (documentId: string, pageNumber: number) => db.pages.get(pageId(documentId, pageNumber)),
  forDocument: (documentId: string) => db.pages.where('documentId').equals(documentId).sortBy('pageNumber'),
  countFor: (documentId: string) => db.pages.where('documentId').equals(documentId).count(),
  put: (page: PageRecord) => db.pages.put(page),
  putMany: (pages: PageRecord[]) => db.pages.bulkPut(pages),

  /** Pages near `pageNumber`, used by the anchor resolver's neighbour fallback. */
  async window(documentId: string, pageNumber: number, radius: number): Promise<PageRecord[]> {
    const lo = Math.max(1, pageNumber - radius)
    const hi = pageNumber + radius
    return db.pages
      .where('[documentId+pageNumber]')
      .between([documentId, lo], [documentId, hi], true, true)
      .toArray()
  },
}

export const outlineRepo = {
  forBook: (bookId: string) => db.outlineNodes.where('bookId').equals(bookId).sortBy('order'),
  putMany: (nodes: OutlineNode[]) => db.outlineNodes.bulkPut(nodes),
  clearForBook: (bookId: string) => db.outlineNodes.where('bookId').equals(bookId).delete(),
}
