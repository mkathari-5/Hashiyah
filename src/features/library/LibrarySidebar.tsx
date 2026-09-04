import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { libraryRepo } from '@/db/repos/libraryTree'
import { noteDocsRepo } from '@/db/repos/notes'
import {
  deleteLibraryNode,
  displayLibraryTitle,
  inspectNodeDeletion,
  restoreNodeDeletion,
  type DeleteImpact,
} from '@/features/library/libraryDelete'
import { LibraryTree } from '@/features/library/LibraryTree'
import { ConfirmDialog } from '@/features/shell/ConfirmDialog'
import { ContextMenu } from '@/features/shell/ContextMenu'
import { Icon } from '@/features/shell/Icon'
import { navigationOutline } from '@/services/notes/NotesService'
import { useLibraryStore } from '@/state/useLibraryStore'
import { useNotesStore } from '@/state/useNotesStore'
import { useStudyStore } from '@/state/useStudyStore'
import type { LibraryNode } from '@/types'

const UNDO_MS = 8000

export function LibrarySidebar({ onImport }: { onImport: () => void }) {
  const showLibrary = useLibraryStore((s) => s.showLibrary)
  const activeNoteId = useStudyStore((s) => s.activeNoteId)
  const requestScrollTo = useNotesStore((s) => s.requestScrollTo)
  const [menu, setMenu] = useState<{ node: LibraryNode; x: number; y: number } | null>(null)
  const [renameRequest, setRenameRequest] = useState<{ id: string; arabic?: boolean } | null>(null)
  const [writeRequest, setWriteRequest] = useState<{ parentId: string } | null>(null)
  const [confirm, setConfirm] = useState<DeleteImpact | null>(null)
  const [undo, setUndo] = useState<{ label: string; restore: () => Promise<void> } | null>(null)

  const outlineRaw = useLiveQuery(
    async () => {
      if (!activeNoteId) return []
      const row = await noteDocsRepo.get(activeNoteId)
      return row ? navigationOutline(row.doc) : []
    },
    [activeNoteId],
    [],
  )

  const outlineKey = JSON.stringify(outlineRaw)
  const outline = useMemo(() => outlineRaw, [outlineKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS)
    return () => window.clearTimeout(timer)
  }, [undo])

  const runDelete = async (impact: DeleteImpact) => {
    const snapshot = await deleteLibraryNode(impact.id)
    if (!snapshot) return
    const restored = snapshot.nodes[0]
    setUndo({
      label: `Deleted “${impact.title}”`,
      restore: async () => {
        await restoreNodeDeletion(snapshot)
        if (restored && restored.type !== 'science' && restored.type !== 'folder') {
          await useLibraryStore.getState().openNode(restored.id)
        }
        setUndo(null)
      },
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-line flex h-11 shrink-0 items-center gap-1 border-b px-2">
        <button
          onClick={showLibrary}
          title="Back to the library"
          className="hover:bg-hover text-ink-muted hover:text-ink flex h-7 flex-1 items-center gap-1.5 rounded-[var(--radius-small)] px-1.5 text-[11px] font-semibold tracking-wide uppercase"
        >
          <Icon name="chevron-right" className="h-3 w-3 rotate-180" />
          Library
        </button>
        <button
          onClick={onImport}
          title="Import a PDF"
          aria-label="Import a PDF"
          className="ui-btn ui-btn-icon"
        >
          <Icon name="import" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1.5">
        <LibraryTree
          variant="sidebar"
          outline={outline}
          onOutlineJump={(blockId) => activeNoteId && requestScrollTo(activeNoteId, blockId)}
          renameRequest={renameRequest}
          onRenameRequestHandled={() => setRenameRequest(null)}
          writeRequest={writeRequest}
          onWriteRequestHandled={() => setWriteRequest(null)}
          onContextMenu={(node, event) => setMenu({ node, x: event.clientX, y: event.clientY })}
        />
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={`Actions for ${displayLibraryTitle(menu.node.title, menu.node.arabicTitle)}`}
          onClose={() => setMenu(null)}
          items={[
            {
              id: 'add',
              label: 'Add item',
              onSelect: () => setWriteRequest({ parentId: menu.node.id }),
            },
            {
              id: 'rename',
              label: 'Rename',
              onSelect: () => setRenameRequest({ id: menu.node.id, arabic: false }),
            },
            {
              id: 'arabic',
              label: 'Arabic title',
              onSelect: () => setRenameRequest({ id: menu.node.id, arabic: true }),
            },
            {
              id: 'favourite',
              label: menu.node.favorite ? 'Remove favourite' : 'Favourite',
              onSelect: () => {
                void libraryRepo.update(menu.node.id, { favorite: !menu.node.favorite })
              },
            },
            {
              id: 'delete',
              label: 'Delete',
              danger: true,
              onSelect: () => {
                void inspectNodeDeletion(menu.node.id).then((impact) => {
                  if (!impact) return
                  if (!impact.needsConfirm) {
                    void runDelete(impact)
                    return
                  }
                  setConfirm(impact)
                })
              },
            },
          ]}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title="Delete item"
          body={[confirm.summary, confirm.detail].filter(Boolean).join(' ')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const impact = confirm
            setConfirm(null)
            void runDelete(impact)
          }}
        />
      )}

      {undo && (
        <div className="undo-toast" role="status">
          <span>{undo.label}</span>
          <button type="button" onClick={() => void undo.restore()}>
            Undo
          </button>
        </div>
      )}
    </div>
  )
}
