import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import { LibraryTree, NodeTitle } from '@/features/library/LibraryTree'
import { Icon } from '@/features/shell/Icon'
import { useLibraryStore } from '@/state/useLibraryStore'
import type { LibraryNode } from '@/types'

/**
 * The Library home (§E1, §E24).
 *
 * The entrance to Ḥāshiyah: you arrive here and decide what to study. Text-first
 * and hierarchical rather than a grid of covers — navigating quickly matters
 * more than decoration (§E25). No large cards, no dashboard.
 */
export function LibraryHome({ onImport }: { onImport: () => void }) {
  const openNode = useLibraryStore((s) => s.openNode)
  const recent = useLiveQuery(() => libraryRepo.recent(5), [], [])
  const favourites = useLiveQuery(() => libraryRepo.favourites(), [], [])
  // Undefined until resolved — so "empty" is not painted during the first tick.
  const allNodes = useLiveQuery(() => libraryRepo.all(), [])
  const [menu, setMenu] = useState<{ node: LibraryNode; x: number; y: number } | null>(null)
  const [renameRequest, setRenameRequest] = useState<{ id: string; arabic?: boolean } | null>(null)

  const continueWith = recent[0]
  const libraryReady = allNodes !== undefined
  const libraryEmpty = libraryReady && allNodes.length === 0

  /**
   * "Chapter 3" on its own tells you nothing on the way back into the app, so
   * everything outside the tree carries the book it belongs to (§F5).
   */
  const byId = new Map((allNodes ?? []).map((n) => [n.id, n]))
  const trail = (node: LibraryNode): string[] => {
    const out: string[] = []
    let parent = node.parentId ? byId.get(node.parentId) : undefined
    while (parent) {
      out.unshift(parent.arabicTitle && !parent.title ? parent.arabicTitle : parent.title)
      parent = parent.parentId ? byId.get(parent.parentId) : undefined
    }
    return out
  }

  return (
    <div className="library-home">
      <div className="library-home-inner">
        <header className="library-masthead">
          <div>
            <p className="library-eyebrow">Ḥāshiyah</p>
            <h1 className="library-title" dir="rtl">
              الإسلام
            </h1>
          </div>
          <button onClick={onImport} className="library-import">
            <Icon name="import" className="h-3.5 w-3.5" />
            Import a PDF
          </button>
        </header>

        {continueWith && (
          <section className="library-section">
            <h2 className="library-section-title">Continue studying</h2>
            <button className="library-continue" onClick={() => void openNode(continueWith.id)}>
              <div className="min-w-0">
                {trail(continueWith).length > 0 && (
                  <p className="library-continue-path">{trail(continueWith).join(' · ')}</p>
                )}
                <NodeTitle node={continueWith} className="library-continue-title" />
                <p className="library-continue-meta">
                  {relativeTime(continueWith.lastOpenedAt)}
                </p>
              </div>
              <span className="library-continue-cta">
                Continue
                <Icon name="chevron-right" className="h-3.5 w-3.5" />
              </span>
            </button>
          </section>
        )}

        {favourites.length > 0 && (
          <section className="library-section">
            <h2 className="library-section-title">Favourites</h2>
            <ul className="library-chips">
              {favourites.map((node) => (
                <li key={node.id}>
                  <button className="library-chip" onClick={() => void openNode(node.id)}>
                    <Icon name="star" className="lib-icon lib-star" />
                    <NodeTitle node={node} className="library-chip-title" />
                    <ChipParent trail={trail(node)} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {recent.length > 1 && (
          <section className="library-section">
            <h2 className="library-section-title">Recently opened</h2>
            <ul className="library-chips">
              {recent.slice(1).map((node) => (
                <li key={node.id}>
                  <button className="library-chip" onClick={() => void openNode(node.id)}>
                    <NodeTitle node={node} className="library-chip-title" />
                    <ChipParent trail={trail(node)} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="library-section">
          <h2 className="library-section-title">Library</h2>
          {!libraryReady && (
            <p className="text-ink-faint py-2 text-xs">Your library is being prepared…</p>
          )}
          {libraryEmpty && (
            <div className="empty-state">
              <p className="empty-state-line">Your library is empty.</p>
              <p className="empty-state-hint">
                Import a book to begin, then add the chapters you are studying underneath it.
              </p>
              <button onClick={onImport} className="empty-state-action">
                Import a PDF
              </button>
            </div>
          )}
          <LibraryTree
            variant="home"
            suppressEmpty
            renameRequest={renameRequest}
            onRenameRequestHandled={() => setRenameRequest(null)}
            onContextMenu={(node, event) => setMenu({ node, x: event.clientX, y: event.clientY })}
          />
        </section>
      </div>

      {menu && (
        <NodeMenu
          {...menu}
          onClose={() => setMenu(null)}
          onRename={(arabic) => {
            setRenameRequest({ id: menu.node.id, arabic })
            setMenu(null)
          }}
        />
      )}
    </div>
  )
}

/** The book a favourite or recent item sits in, kept to the right and quiet. */
function ChipParent({ trail }: { trail: string[] }) {
  const parent = trail.at(-1)
  if (!parent) return null
  return (
    <span className="library-chip-parent" dir="auto">
      {parent}
    </span>
  )
}

function relativeTime(at: number | null): string {
  if (!at) return 'Not opened yet'
  const seconds = Math.round((Date.now() - at) / 1000)
  if (seconds < 60) return 'Opened moments ago'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `Opened ${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Opened ${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `Opened ${days} day${days === 1 ? '' : 's'} ago`
}

/** §E21 — one contextual menu shape shared by every node type. */
function NodeMenu({
  node,
  x,
  y,
  onClose,
  onRename,
}: {
  node: LibraryNode
  x: number
  y: number
  onClose: () => void
  onRename: (arabic?: boolean) => void
}) {
  const remove = async () => {
    const kids = await libraryRepo.descendants(node.id)
    const warning =
      kids.length > 0
        ? `Delete “${node.title || 'Untitled'}” and ${kids.length} item${kids.length === 1 ? '' : 's'} inside it?\n\nNotes belonging to them will be deleted. The PDF itself is kept.`
        : `Delete “${node.title || 'Untitled'}”?\n\nIts notes will be deleted. The PDF itself is kept.`
    if (!window.confirm(warning)) return
    await libraryRepo.remove(node.id)
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div className="node-menu" style={{ left: Math.min(x, window.innerWidth - 220), top: y }}>
        <button className="block-menu-item" onClick={() => onRename(false)}>
          <Icon name="pencil" className="block-menu-icon" />
          <span className="flex-1">Rename</span>
        </button>
        <button className="block-menu-item" onClick={() => onRename(true)}>
          <span className="block-menu-icon font-arabic">ع</span>
          <span className="flex-1">Arabic title</span>
        </button>
        <button
          className="block-menu-item"
          onClick={async () => {
            await libraryRepo.update(node.id, { favorite: !node.favorite })
            onClose()
          }}
        >
          <Icon name="star" className="block-menu-icon" />
          <span className="flex-1">{node.favorite ? 'Remove favourite' : 'Favourite'}</span>
        </button>
        <button
          className="block-menu-item"
          onClick={async () => {
            await libraryRepo.create({ parentId: node.id, type: 'notes', title: '' })
            await libraryRepo.update(node.id, { collapsed: false })
            onClose()
          }}
        >
          <Icon name="note" className="block-menu-icon" />
          <span className="flex-1">New notes item</span>
        </button>
        <div className="block-menu-sep" />
        <button className="block-menu-item is-danger" onClick={remove}>
          <Icon name="trash" className="block-menu-icon" />
          <span className="flex-1">Delete</span>
        </button>
      </div>
    </>
  )
}

export { db }
