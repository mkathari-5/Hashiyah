/**
 * The open Notes editor, if any. Creating a section while that document is
 * live must go through Tiptap so autosave cannot clobber the insert.
 */

export interface LiveNoteEditor {
  noteId: string
  insertNamedToggle: (options: { title: string; parentBlockId?: string | null; blockId: string }) => boolean
  getJSON: () => unknown
  flush: () => Promise<void>
  applyJSON: (doc: unknown) => void
}

let live: LiveNoteEditor | null = null

export function registerLiveNoteEditor(handler: LiveNoteEditor): () => void {
  live = handler
  return () => {
    if (live === handler) live = null
  }
}

export function peekLiveNoteId(): string | null {
  return live?.noteId ?? null
}

/** Unsaved editor JSON for the open note, if any. */
export function peekLiveNoteDoc(noteId: string): unknown | null {
  if (!live || live.noteId !== noteId) return null
  return live.getJSON()
}

export function insertSectionInLiveEditor(options: {
  noteId: string
  title: string
  parentBlockId?: string | null
  blockId: string
}): boolean {
  if (!live || live.noteId !== options.noteId) return false
  return live.insertNamedToggle({
    title: options.title,
    parentBlockId: options.parentBlockId,
    blockId: options.blockId,
  })
}

/** Persist the open editor so Dexie matches Tiptap before a link row is written. */
export async function flushLiveNote(noteId: string): Promise<void> {
  if (!live || live.noteId !== noteId) return
  await live.flush()
}

/**
 * Replace the open editor's document with already-saved JSON.
 * Used when a section was written to Dexie while Tiptap still had the old tree.
 */
export function applyLiveNoteDoc(noteId: string, doc: unknown): boolean {
  if (!live || live.noteId !== noteId) return false
  live.applyJSON(doc)
  return true
}
