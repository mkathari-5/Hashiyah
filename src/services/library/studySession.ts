import { libraryRepo } from '@/db/repos/libraryTree'
import { ensureNodeNote, resolveBookId } from '@/services/library/bootstrap'
import { useNotesStore } from '@/state/useNotesStore'
import { useStudyStore } from '@/state/useStudyStore'
import type { LibraryNode } from '@/types'

export interface LoadStudySessionOptions {
  noteId?: string | null
  noteBlockId?: string | null
  page?: number | null
  sourceAnchor?: string | null
}

/**
 * Puts the PDF, notes and last-read position behind a library node.
 *
 * Does not change which library row is selected — callers own `activeNodeId`
 * so this module never imports the library store.
 */
export async function expandAncestorNodes(nodeId: string): Promise<void> {
  const node = await libraryRepo.get(nodeId)
  let current = node?.parentId ?? null
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const parent = await libraryRepo.get(current)
    if (!parent) break
    if (parent.collapsed) await libraryRepo.update(parent.id, { collapsed: false })
    current = parent.parentId
  }
}

export async function loadStudySession(node: LibraryNode, options: LoadStudySessionOptions = {}): Promise<void> {
  await expandAncestorNodes(node.id)

  const bookId = await resolveBookId(node)
  if (bookId) await useStudyStore.getState().openBook(bookId)
  else useStudyStore.getState().clearPdf()

  const noteId = options.noteId ?? (await ensureNodeNote(node.id))
  if (noteId) useStudyStore.getState().setActiveNote(noteId)

  if (options.page && options.page > 0) useStudyStore.getState().setPage(options.page)
  else if (node.pageStart) useStudyStore.getState().setPage(node.pageStart)

  if (options.noteBlockId && noteId) {
    useNotesStore.getState().requestScrollTo(noteId, options.noteBlockId)
  }
  if (options.sourceAnchor) useStudyStore.getState().requestJump(options.sourceAnchor)
}
