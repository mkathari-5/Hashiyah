import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import { LibraryTree, NodeTitle } from '@/features/library/LibraryTree'
import { Icon } from '@/features/shell/Icon'
import { useLibraryStore } from '@/state/useLibraryStore'
import type { LibraryNode, LibraryNodeType } from '@/types'

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
  const [menu, setMenu] = useState<{ node: LibraryNode; x: number; y: number } | null>(null)

  const continueWith = recent[0]

  const addChild = async (parent: LibraryNode) => {
    const type: LibraryNodeType =
      parent.type === 'book' || parent.type === 'course' ? 'chapter' : 'book'
    const label = type === 'chapter' ? 'New chapter' : 'New book'
    const title = window.prompt(`${label} — English title`, '')?.trim()
    if (!title) return
    const arabicTitle = window.prompt(`${label} — Arabic title (optional)`, '')?.trim() || undefined
    await libraryRepo.create({ parentId: parent.id, type, title, arabicTitle })
    await libraryRepo.update(parent.id, { collapsed: false })
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
                    <Icon name="star" className="h-3 w-3" />
                    <NodeTitle node={node} />
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
                    <NodeTitle node={node} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="library-section">
          <h2 className="library-section-title">Library</h2>
          <LibraryTree
            variant="home"
            onAdd={(node) => void addChild(node)}
            onContextMenu={(node, event) => setMenu({ node, x: event.clientX, y: event.clientY })}
          />
        </section>
      </div>

      {menu && <NodeMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
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
}: {
  node: LibraryNode
  x: number
  y: number
  onClose: () => void
}) {
  const isContainer = ['science', 'folder', 'book', 'course'].includes(node.type)

  const rename = async () => {
    const title = window.prompt('Title', node.title)?.trim()
    if (title) await libraryRepo.update(node.id, { title })
    onClose()
  }
  const renameArabic = async () => {
    const arabicTitle = window.prompt('Arabic title', node.arabicTitle ?? '')?.trim()
    await libraryRepo.update(node.id, { arabicTitle: arabicTitle || undefined })
    onClose()
  }
  const remove = async () => {
    const kids = await libraryRepo.descendants(node.id)
    const warning =
      kids.length > 0
        ? `Delete “${node.title}” and ${kids.length} item${kids.length === 1 ? '' : 's'} inside it?\n\nNotes belonging to them will be deleted. The PDF itself is kept.`
        : `Delete “${node.title}”?\n\nIts notes will be deleted. The PDF itself is kept.`
    if (!window.confirm(warning)) return
    await libraryRepo.remove(node.id)
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div className="node-menu" style={{ left: Math.min(x, window.innerWidth - 220), top: y }}>
        <button className="block-menu-item" onClick={rename}>
          <span className="block-menu-icon">✎</span>
          <span className="flex-1">Rename</span>
        </button>
        <button className="block-menu-item" onClick={renameArabic}>
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
          <span className="block-menu-icon">★</span>
          <span className="flex-1">{node.favorite ? 'Remove favourite' : 'Favourite'}</span>
        </button>
        {isContainer && (
          <button
            className="block-menu-item"
            onClick={async () => {
              const type: LibraryNodeType = node.type === 'book' || node.type === 'course' ? 'chapter' : 'book'
              const title = window.prompt(type === 'chapter' ? 'Chapter title' : 'Book title', '')?.trim()
              if (title) {
                await libraryRepo.create({ parentId: node.id, type, title })
                await libraryRepo.update(node.id, { collapsed: false })
              }
              onClose()
            }}
          >
            <span className="block-menu-icon">＋</span>
            <span className="flex-1">{node.type === 'book' || node.type === 'course' ? 'New chapter' : 'New book'}</span>
          </button>
        )}
        <button
          className="block-menu-item"
          onClick={async () => {
            const title = window.prompt('Notes item title', '')?.trim()
            if (title) {
              await libraryRepo.create({ parentId: node.id, type: 'notes', title })
              await libraryRepo.update(node.id, { collapsed: false })
            }
            onClose()
          }}
        >
          <span className="block-menu-icon">▪</span>
          <span className="flex-1">New notes item</span>
        </button>
        <div className="block-menu-sep" />
        <button className="block-menu-item is-danger" onClick={remove}>
          <span className="block-menu-icon">🗑</span>
          <span className="flex-1">Delete</span>
        </button>
      </div>
    </>
  )
}

export { db }
