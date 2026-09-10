import { create } from 'zustand'
import { libraryRepo } from '@/db/repos/libraryTree'
import { appStateRepo } from '@/db/repos/session'
import { loadStudySession } from '@/services/library/studySession'
import {
  pushLibraryHistory,
  pushStudyHistory,
  readWorkspaceHash,
  replaceStudyHistory,
} from '@/services/library/workspaceHistory'

/**
 * Which part of the library is open (§E10, §E28, §E31).
 *
 * The library is the entrance: a node is what you select, and everything else —
 * which PDF is on screen, which notes are in the right-hand panel — follows
 * from it. Opening a chapter must always reopen *the same* notes document, so
 * that relationship is resolved through `ensureNodeNote` rather than by
 * creating something new each time. Homepage Book/PDF blocks, search, and the
 * command palette share `openStudyWorkspace`, which writes this store.
 */

interface LibraryState {
  /** null means the Library home is showing rather than a study session. */
  activeNodeId: string | null
  hydrated: boolean

  hydrate: () => Promise<void>
  openNode: (nodeId: string) => Promise<void>
  /** Highlight a library row without moving the PDF or swapping the note. */
  highlightNode: (nodeId: string) => Promise<void>
  /** Always enter Study — used by Study-page blocks, including sciences. */
  openStudySession: (nodeId: string) => Promise<void>
  showLibrary: (history?: 'push' | 'none') => void
  toggleExpanded: (nodeId: string, collapsed: boolean) => Promise<void>
}

async function enterSession(nodeId: string, history: 'push' | 'replace' | 'none' = 'push'): Promise<void> {
  const node = await libraryRepo.get(nodeId)
  if (!node) return
  useLibraryStore.setState({ activeNodeId: nodeId })
  void appStateRepo.set('activeLibraryNode', nodeId)
  if (history === 'replace') replaceStudyHistory(nodeId)
  else if (history !== 'none') pushStudyHistory(nodeId)
  try {
    await loadStudySession(node)
    await libraryRepo.touch(nodeId)
  } catch {
    // Missing PDF bytes must not keep the user on the homepage.
  }
}

export const useLibraryStore = create<LibraryState>((set) => ({
  activeNodeId: null,
  hydrated: false,

  async hydrate() {
    const storedId = await appStateRepo.get<string | null>('activeLibraryNode', null)
    const fromHash = readWorkspaceHash()
    const activeNodeId =
      fromHash?.view === 'study'
        ? fromHash.nodeId
        : fromHash?.view === 'library'
          ? null
          : storedId
    // Only restore if the node still exists — a deleted chapter must not leave
    // the app pointing at nothing. Direct links wait until bootstrap has already
    // run (see App.tsx) rather than guessing by title.
    const node = activeNodeId ? await libraryRepo.get(activeNodeId) : null
    if (!node) {
      set({ activeNodeId: null, hydrated: true })
      return
    }

    // Mark hydrated first so the shell can render the study layout, then
    // actually reopen the session. Restoring only the selection would leave
    // the sidebar highlighting a chapter with no book and no notes behind it
    // (§E31) — the point of Continue Studying is to land you back at work.
    set({ activeNodeId, hydrated: true })
    try {
      await loadStudySession(node)
      replaceStudyHistory(node.id)
    } catch {
      // A book whose file is missing should not block start-up; the reader
      // surfaces its own error and the library stays usable.
    }
  },

  async openNode(nodeId) {
    const node = await libraryRepo.get(nodeId)
    if (!node) return

    // In the Study sidebar a science or folder is a container, not a destination.
    if (node.type === 'science' || node.type === 'folder') {
      await libraryRepo.update(nodeId, { collapsed: !node.collapsed })
      return
    }

    await enterSession(nodeId)
  },

  async highlightNode(nodeId) {
    const node = await libraryRepo.get(nodeId)
    if (!node) return
    await libraryRepo.touch(nodeId)
    set({ activeNodeId: nodeId })
    void appStateRepo.set('activeLibraryNode', nodeId)
  },

  async openStudySession(nodeId) {
    const node = await libraryRepo.get(nodeId)
    if (!node) return
    await enterSession(nodeId)
  },

  showLibrary(history = 'push') {
    set({ activeNodeId: null })
    void appStateRepo.set('activeLibraryNode', null)
    if (history !== 'none') pushLibraryHistory()
  },

  async toggleExpanded(nodeId, collapsed) {
    await libraryRepo.update(nodeId, { collapsed })
  },
}))
