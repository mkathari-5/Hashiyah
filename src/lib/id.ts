import { nanoid } from 'nanoid'

/** Prefixed ids make raw IndexedDB dumps and exports readable by a human. */
export const newId = (prefix: string): string => `${prefix}_${nanoid(14)}`

export const ids = {
  subject: () => newId('sub'),
  book: () => newId('bk'),
  document: () => newId('doc'),
  outline: () => newId('out'),
  annotation: () => newId('ann'),
  anchor: () => newId('anc'),
  note: () => newId('nt'),
  block: () => newId('blk'),
  layer: () => newId('lyr'),
  bookmark: () => newId('bm'),
  lesson: () => newId('les'),
}

export const pageId = (documentId: string, pageNumber: number) => `${documentId}:${pageNumber}`
