import { create } from 'zustand'
import { libraryRepo } from '@/db/repos/libraryTree'
import { appStateRepo } from '@/db/repos/session'
import { ensureNodeNote, resolveBookId } from '@/services/library/bootstrap'
import { useStudyStore } from '@/state/useStudyStore'

/**
 * Which part of the library is open (§E10, §E28, §E31).
 *
 * The library is the entrance: a node is what you select, and everything else —
 * which PDF is on screen, which notes are in the right-hand panel — follows
 * from it. Opening a chapter must always reopen *the same* notes document, so
 * that relationship is resolved through `ensureNodeNote` rather than by
 * creating something new each time.
 */

interface LibraryState {
  /** null means the Library home is showing rather than a study session. */
  activeNodeId: string | null
  hydrated: boolean

  hydrate: () => Promise<void>
  openNode: (nodeId: string) => Promise<void>
  showLibrary: () => void
  toggleExpanded: (nodeId: string, collapsed: boolean) => Promise<void>
}

export const useLibraryStore = create<LibraryState>((set) => ({
  activeNodeId: null,
  hydrated: false,

  async hydrate() {
    const activeNodeId = await appStateRepo.get<string | null>('activeLibraryNode', null)
    // Only restore if the node still exists — a deleted chapter must not leave
    // the app pointing at nothing.
    const node = activeNodeId ? await libraryRepo.get(activeNodeId) : null
    set({ activeNodeId: node ? activeNodeId : null, hydrated: true })
  },

  async openNode(nodeId) {
    const node = await libraryRepo.get(nodeId)
    if (!node) return

    const study = useStudyStore.getState()
    const bookId = await resolveBookId(node)

    // A science or folder is a container, not a destination.
    if (node.type === 'science' || node.type === 'folder') {
      await libraryRepo.update(nodeId, { collapsed: !node.collapsed })
      return
    }

    if (bookId) await study.openBook(bookId)

    // §E10/§E45 — one stable notes document per node, reused forever.
    const noteId = await ensureNodeNote(nodeId)
    if (noteId) useStudyStore.getState().setActiveNote(noteId)

    // §E13 — go to the chapter's page range if it has one; otherwise leave the
    // reader where it was rather than jumping somewhere arbitrary.
    if (node.pageStart) useStudyStore.getState().setPage(node.pageStart)

    await libraryRepo.touch(nodeId)
    set({ activeNodeId: nodeId })
    void appStateRepo.set('activeLibraryNode', nodeId)
  },

  showLibrary() {
    set({ activeNodeId: null })
    void appStateRepo.set('activeLibraryNode', null)
  },

  async toggleExpanded(nodeId, collapsed) {
    await libraryRepo.update(nodeId, { collapsed })
  },
}))
