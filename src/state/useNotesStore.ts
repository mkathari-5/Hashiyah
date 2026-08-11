import { create } from 'zustand'

/**
 * The channel between "something happened in the PDF" and "the editor should do
 * this". Modelled as one-shot requests with a nonce so the same request twice
 * in a row still fires twice.
 *
 * This is the seam that keeps the editor free of PDF knowledge: it receives an
 * annotation id and a shape, and knows nothing about pages or anchors.
 */

/**
 * What to build around the incoming source (§D3–§D5, §D10).
 *
 *  quote    — the passage alone. Nothing else, no cursor move.
 *  explain  — passage + an empty paragraph beneath, cursor in it.
 *  semantic — passage + a named study block beneath, cursor in it.
 *  image    — a captured region.
 */
export type InsertShape = 'quote' | 'explain' | 'semantic' | 'image'

export interface InsertRequest {
  shape: InsertShape
  /** Present for text sources; absent for a bare image with no anchor. */
  annotationId: string | null
  /** Semantic block kind, when shape is 'semantic'. */
  blockKind: string | null
  /** Asset id, when shape is 'image'. */
  assetId: string | null
  /** Follow an image with an empty paragraph and put the cursor there. */
  withExplanation: boolean
  nonce: number
}

interface NotesState {
  pendingInsert: InsertRequest | null
  requestInsert: (request: Omit<InsertRequest, 'nonce'>) => void
  clearInsert: () => void
}

let nonce = 0

const base = {
  annotationId: null,
  blockKind: null,
  assetId: null,
  withExplanation: false,
}

export const useNotesStore = create<NotesState>((set) => ({
  pendingInsert: null,
  requestInsert: (request) => set({ pendingInsert: { ...base, ...request, nonce: ++nonce } }),
  clearInsert: () => set({ pendingInsert: null }),
}))
