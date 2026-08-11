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

/**
 * "Scroll the note to this block" — issued by the sidebar outline and by search
 * results. Carries a nonce so asking twice for the same block still fires
 * twice, and a noteId so a request cannot be consumed by the wrong document
 * when navigation and loading race.
 */
export interface ScrollRequest {
  noteId: string
  blockId: string
  nonce: number
}

interface NotesState {
  pendingInsert: InsertRequest | null
  requestInsert: (request: Omit<InsertRequest, 'nonce'>) => void
  clearInsert: () => void

  pendingScroll: ScrollRequest | null
  requestScrollTo: (noteId: string, blockId: string) => void
  clearScroll: () => void

  /**
   * Revision mode (§E30, §6).
   *
   * Only the flag lives here. The snapshot of how the reader had actually left
   * their toggles belongs to the open chapter's editor, which is what makes
   * revision chapter-local: leaving a chapter cannot carry a snapshot of *its*
   * sections into the next one, because there is nowhere for it to travel.
   */
  revisionMode: boolean
  setRevisionMode: (on: boolean) => void
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

  pendingScroll: null,
  requestScrollTo: (noteId, blockId) => set({ pendingScroll: { noteId, blockId, nonce: ++nonce } }),
  clearScroll: () => set({ pendingScroll: null }),

  revisionMode: false,
  setRevisionMode: (revisionMode) => set({ revisionMode }),
}))
