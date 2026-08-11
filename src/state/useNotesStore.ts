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
   * The snapshot is what makes this non-destructive: entering records every
   * toggle's real state, and leaving puts it back. Without it, a glance at a
   * chapter in revision mode would silently flatten how the reader had left
   * their notes.
   */
  revisionMode: boolean
  revisionSnapshot: Record<string, boolean> | null
  setRevisionMode: (on: boolean, snapshot?: Record<string, boolean> | null) => void
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
  revisionSnapshot: null,
  setRevisionMode: (revisionMode, revisionSnapshot) =>
    set((state) => ({
      revisionMode,
      /**
       * The snapshot outlives the mode on purpose. Clearing it when revision
       * is switched off would destroy the very thing the editor needs a moment
       * later to put the reader's toggles back — leaving a chapter flattened
       * simply because they glanced at it in revision mode.
       *
       * `undefined` means "leave it alone"; an explicit value replaces it.
       */
      revisionSnapshot: revisionSnapshot === undefined ? state.revisionSnapshot : revisionSnapshot,
    })),
}))
