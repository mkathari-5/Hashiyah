import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { libraryRepo } from '@/db/repos/libraryTree'
import { noteDocsRepo } from '@/db/repos/notes'
import { LibraryTree } from '@/features/library/LibraryTree'
import { Icon } from '@/features/shell/Icon'
import { navigationOutline } from '@/services/notes/NotesService'
import { useLibraryStore } from '@/state/useLibraryStore'
import { useNotesStore } from '@/state/useNotesStore'
import { useStudyStore } from '@/state/useStudyStore'
import type { LibraryNode, LibraryNodeType } from '@/types'

/**
 * The compact library while studying (§E4).
 *
 * The same tree as the home page, denser, with a way back to the library. It
 * reads the same data through the same component — there is no second library.
 */
export function LibrarySidebar({ onImport }: { onImport: () => void }) {
  const showLibrary = useLibraryStore((s) => s.showLibrary)
  const activeNoteId = useStudyStore((s) => s.activeNoteId)
  const requestScrollTo = useNotesStore((s) => s.requestScrollTo)
  const [menu, setMenu] = useState<{ node: LibraryNode; x: number; y: number } | null>(null)

  /**
   * The active chapter's outline, read from its saved document.
   *
   * Driven by the note's persisted doc rather than by editor keystrokes, so the
   * sidebar updates when a save lands (every ~400 ms of idle) instead of on
   * every character — ordinary typing must not re-render the library.
   */
  const outlineRaw = useLiveQuery(
    async () => {
      if (!activeNoteId) return []
      const row = await noteDocsRepo.get(activeNoteId)
      return row ? navigationOutline(row.doc) : []
    },
    [activeNoteId],
    [],
  )

  // Stabilise the reference so the tree only re-renders when the *outline*
  // actually changes, not merely because a save produced a new object.
  const outlineKey = JSON.stringify(outlineRaw)
  const outline = useMemo(() => outlineRaw, [outlineKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const addChild = async (parent: LibraryNode) => {
    const type: LibraryNodeType = parent.type === 'book' || parent.type === 'course' ? 'chapter' : 'book'
    const title = window.prompt(type === 'chapter' ? 'Chapter title' : 'Book title', '')?.trim()
    if (!title) return
    const arabicTitle = window.prompt('Arabic title (optional)', '')?.trim() || undefined
    await libraryRepo.create({ parentId: parent.id, type, title, arabicTitle })
    await libraryRepo.update(parent.id, { collapsed: false })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-line flex h-11 shrink-0 items-center gap-1 border-b px-2">
        <button
          onClick={showLibrary}
          title="Back to the library"
          className="hover:bg-hover text-ink-muted hover:text-ink flex h-7 flex-1 items-center gap-1.5 rounded px-1.5 text-[11px] font-semibold tracking-wide uppercase"
        >
          <Icon name="chevron-right" className="h-3 w-3 rotate-180" />
          Library
        </button>
        <button
          onClick={onImport}
          title="Import a PDF"
          aria-label="Import a PDF"
          className="hover:bg-hover text-ink-muted hover:text-ink grid h-7 w-7 place-items-center rounded"
        >
          <Icon name="import" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1.5">
        <LibraryTree
          variant="sidebar"
          outline={outline}
          onOutlineJump={(blockId) => activeNoteId && requestScrollTo(activeNoteId, blockId)}
          onAdd={(node) => void addChild(node)}
          onContextMenu={(node, event) => setMenu({ node, x: event.clientX, y: event.clientY })}
        />
      </div>

      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div
            className="node-menu"
            style={{ left: Math.min(menu.x, window.innerWidth - 220), top: menu.y }}
          >
            <button
              className="block-menu-item"
              onClick={async () => {
                const title = window.prompt('Title', menu.node.title)?.trim()
                if (title) await libraryRepo.update(menu.node.id, { title })
                setMenu(null)
              }}
            >
              <span className="block-menu-icon">✎</span>
              <span className="flex-1">Rename</span>
            </button>
            <button
              className="block-menu-item"
              onClick={async () => {
                await libraryRepo.update(menu.node.id, { favorite: !menu.node.favorite })
                setMenu(null)
              }}
            >
              <span className="block-menu-icon">★</span>
              <span className="flex-1">{menu.node.favorite ? 'Remove favourite' : 'Favourite'}</span>
            </button>
            <div className="block-menu-sep" />
            <button
              className="block-menu-item is-danger"
              onClick={async () => {
                const kids = await libraryRepo.descendants(menu.node.id)
                const message =
                  kids.length > 0
                    ? `Delete “${menu.node.title}” and ${kids.length} item${kids.length === 1 ? '' : 's'} inside it?\n\nTheir notes will be deleted. The PDF itself is kept.`
                    : `Delete “${menu.node.title}”?\n\nIts notes will be deleted. The PDF itself is kept.`
                if (window.confirm(message)) await libraryRepo.remove(menu.node.id)
                setMenu(null)
              }}
            >
              <span className="block-menu-icon">🗑</span>
              <span className="flex-1">Delete</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
