import { booksRepo } from '@/db/repos/library'
import { libraryRepo } from '@/db/repos/libraryTree'
import { appStateRepo } from '@/db/repos/session'
import { ensureLibraryNodeForBlock } from '@/services/library/bookAttachment'
import { loadStudySession } from '@/services/library/studySession'
import { pushLibraryHistory, pushStudyHistory, replaceStudyHistory } from '@/services/library/workspaceHistory'
import { useAppStore } from '@/state/useAppStore'
import { useLibraryStore } from '@/state/useLibraryStore'
import type { LibraryNode } from '@/types'

export interface OpenStudyWorkspaceInput {
  libraryItemId?: string | null
  libraryBlockId?: string | null
  bookId?: string | null
  pdfId?: string | null
  noteId?: string | null
  noteBlockId?: string | null
  page?: number | null
  sourceAnchor?: string | null
  /** Sidebar sciences/folders toggle instead of opening Study. */
  containerBehavior?: 'toggle' | 'open'
  history?: 'push' | 'replace' | 'none'
  forceThreePane?: boolean
}

export type OpenStudyWorkspaceResult =
  | { ok: true; node: LibraryNode; toggled?: boolean }
  | { ok: false; reason: 'missing-item' | 'missing-block' }

async function resolveNode(input: OpenStudyWorkspaceInput): Promise<LibraryNode | null> {
  if (input.libraryBlockId) {
    const fromBlock = await ensureLibraryNodeForBlock(input.libraryBlockId)
    if (fromBlock) return fromBlock
  }
  if (input.libraryItemId) {
    const node = await libraryRepo.get(input.libraryItemId)
    if (node) return node
  }
  if (input.bookId) {
    const nodes = await libraryRepo.forBook(input.bookId)
    const existing = nodes.find((row) => row.type === 'book') ?? nodes[0]
    if (existing) return existing
    const book = await booksRepo.get(input.bookId)
    if (!book) return null
    return libraryRepo.create({
      parentId: null,
      type: 'book',
      title: book.title,
      arabicTitle: book.arabicTitle,
      bookId: book.id,
    })
  }
  return null
}

/**
 * One navigation action for homepage attachments, titles, chapters, notes,
 * search hits and command-palette book rows.
 */
export async function openStudyWorkspace(input: OpenStudyWorkspaceInput): Promise<OpenStudyWorkspaceResult> {
  const node = await resolveNode(input)
  if (!node) {
    return { ok: false, reason: input.libraryBlockId ? 'missing-block' : 'missing-item' }
  }

  if (
    input.containerBehavior === 'toggle' &&
    (node.type === 'science' || node.type === 'folder')
  ) {
    await libraryRepo.update(node.id, { collapsed: !node.collapsed })
    return { ok: true, node, toggled: true }
  }

  const fromHome = useLibraryStore.getState().activeNodeId === null
  if (fromHome || input.forceThreePane) useAppStore.getState().setLayout('three')

  // Switch the shell first so the homepage never waits on PDF bytes. Session
  // load can then fill the reader; a missing file surfaces inside the panel.
  useLibraryStore.setState({ activeNodeId: node.id })
  void appStateRepo.set('activeLibraryNode', node.id)
  if (input.history === 'replace') replaceStudyHistory(node.id)
  else if (input.history !== 'none') pushStudyHistory(node.id)

  try {
    await loadStudySession(node, {
      noteId: input.noteId,
      noteBlockId: input.noteBlockId,
      page: input.page,
      sourceAnchor: input.sourceAnchor,
    })
    await libraryRepo.touch(node.id)
  } catch {
    // The reader shows its own missing/corrupt PDF state; notes still open.
  }

  return { ok: true, node }
}

export function returnToLibraryHome(history: 'push' | 'replace' | 'none' = 'push') {
  useLibraryStore.setState({ activeNodeId: null })
  void appStateRepo.set('activeLibraryNode', null)
  if (history === 'replace') {
    /* AppShell initial landing — hash already library or empty */
  } else if (history !== 'none') {
    pushLibraryHistory()
  }
}
