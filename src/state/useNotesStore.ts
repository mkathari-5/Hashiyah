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

/**
 * One chapter's revision, in progress.
 *
 * `originalToggleStates` is what makes the mode non-destructive: it is the
 * document as the reader actually left it, kept apart from the flattened copy
 * they are reading, and written back by every save.
 */
export interface RevisionSession {
  noteId: string
  active: boolean
  /** Null until the editor has looked at the document and recorded it. */
  originalToggleStates: Record<string, boolean> | null
}

interface NotesState {
  pendingInsert: InsertRequest | null
  requestInsert: (request: Omit<InsertRequest, 'nonce'>) => void
  clearInsert: () => void

  pendingScroll: ScrollRequest | null
  requestScrollTo: (noteId: string, blockId: string) => void
  clearScroll: () => void

  /**
   * The revision session (§E30, §6).
   *
   * `noteId` is the whole design. Revision cannot be a global flag — the
   * snapshot it depends on describes one document's sections, and a mode that
   * outlived its chapter would flatten the next one. Nor can it live in the
   * editor: the panel group remounts on every layout change, and a reader
   * pressing Ctrl+3 has not asked to leave revision. So it lives here, named
   * after the note it belongs to, and applies to nothing else.
   */
  revision: RevisionSession | null
  /** Turn revision on or off for one note. */
  setRevisionMode: (noteId: string, on: boolean) => void
  /** Record how the reader had left this note's toggles, once, on entry. */
  captureRevisionStates: (noteId: string, states: Record<string, boolean>) => void
  /** Leaving for another note ends revision; arriving at one says so. */
  endRevisionElsewhere: (noteId: string) => void
  /** Done: the sections have been put back. */
  clearRevision: () => void
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

  revision: null,

  setRevisionMode: (noteId, on) =>
    set((state) => {
      const current = state.revision?.noteId === noteId ? state.revision : null
      if (on) {
        // Re-entering the note keeps what was already recorded; anything
        // belonging to another note is replaced outright, never merged.
        return { revision: { noteId, active: true, originalToggleStates: current?.originalToggleStates ?? null } }
      }
      // Switching off leaves the session in place for one more moment: the
      // editor still has to read it to put the reader's sections back.
      return current ? { revision: { ...current, active: false } } : {}
    }),

  captureRevisionStates: (noteId, originalToggleStates) =>
    set((state) =>
      state.revision?.noteId === noteId && state.revision.originalToggleStates === null
        ? { revision: { ...state.revision, originalToggleStates } }
        : {},
    ),

  endRevisionElsewhere: (noteId) =>
    set((state) => (state.revision && state.revision.noteId !== noteId ? { revision: null } : {})),

  clearRevision: () => set({ revision: null }),
}))

/**
 * Is revision on for this note?
 *
 * The only correct way to ask: a session for a different chapter is not this
 * chapter's business, and reading the flag without the id is how revision
 * escapes into the next document.
 */
export function isRevising(state: { revision: RevisionSession | null }, noteId: string | null): boolean {
  return !!noteId && state.revision?.noteId === noteId && state.revision.active
}
