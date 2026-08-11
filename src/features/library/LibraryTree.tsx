import { useCallback, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { libraryRepo } from '@/db/repos/libraryTree'
import { Icon, type IconName } from '@/features/shell/Icon'
import { useLibraryStore } from '@/state/useLibraryStore'
import type { LibraryNode, LibraryNodeType } from '@/types'

/**
 * The library tree (§E4, §E16, §E42).
 *
 * One component, two presentations: the full Library home and the compact
 * study sidebar render the same data with the same interactions, differing
 * only in density. Building two trees over one model is how they drift apart.
 */

const ICONS: Record<LibraryNodeType, IconName> = {
  science: 'layers',
  folder: 'folder',
  book: 'book',
  course: 'layers',
  chapter: 'note',
  lesson: 'note',
  notes: 'note',
}

/** Containers hold things; the rest are destinations you open. */
const CONTAINERS: LibraryNodeType[] = ['science', 'folder', 'book', 'course']

/**
 * §E27/§E43 — a mixed title like `Chapter 3 — باب الخوف من الشرك` will scatter
 * its number and dash to unpredictable places if the two scripts share one
 * bidi context. Each part is isolated so each lays out on its own terms.
 */
export function NodeTitle({
  node,
  className = '',
}: {
  node: Pick<LibraryNode, 'title' | 'arabicTitle' | 'type'>
  className?: string
}) {
  const hasBoth = !!node.title && !!node.arabicTitle
  return (
    <span className={`lib-title ${className}`}>
      {node.title && <bdi className="lib-title-latin">{node.title}</bdi>}
      {hasBoth && (
        <span className="lib-title-sep" aria-hidden>
          —
        </span>
      )}
      {node.arabicTitle && (
        <bdi className="lib-title-arabic font-arabic" dir="rtl">
          {node.arabicTitle}
        </bdi>
      )}
    </span>
  )
}

interface TreeProps {
  /** 'sidebar' is denser and hides the add affordances until hover. */
  variant: 'home' | 'sidebar'
  onContextMenu?: (node: LibraryNode, event: React.MouseEvent) => void
  onAdd?: (node: LibraryNode) => void
}

export function LibraryTree({ variant, onContextMenu, onAdd }: TreeProps) {
  const nodes = useLiveQuery(() => libraryRepo.all(), [], [])
  const activeNodeId = useLibraryStore((s) => s.activeNodeId)
  const openNode = useLibraryStore((s) => s.openNode)
  const toggleExpanded = useLibraryStore((s) => s.toggleExpanded)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const byParent = useMemo(() => {
    const map = new Map<string | null, LibraryNode[]>()
    for (const node of nodes) {
      const list = map.get(node.parentId) ?? []
      list.push(node)
      map.set(node.parentId, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order)
    return map
  }, [nodes])

  const handleDrop = useCallback(
    async (target: LibraryNode) => {
      if (!dragId || dragId === target.id) return
      const dragged = nodes.find((n) => n.id === dragId)
      if (!dragged) return
      // Dropping onto a container files it inside; onto a leaf, beside it.
      if (CONTAINERS.includes(target.type)) {
        const children = byParent.get(target.id) ?? []
        await libraryRepo.move(dragId, target.id, children.length)
        await libraryRepo.update(target.id, { collapsed: false })
      } else {
        const siblings = byParent.get(target.parentId) ?? []
        await libraryRepo.move(dragId, target.parentId, siblings.findIndex((n) => n.id === target.id))
      }
      setDragId(null)
      setDropTarget(null)
    },
    [dragId, nodes, byParent],
  )

  const renderNode = (node: LibraryNode, depth: number): React.ReactNode => {
    const children = byParent.get(node.id) ?? []
    const isContainer = CONTAINERS.includes(node.type)
    const expanded = !node.collapsed
    const selected = activeNodeId === node.id

    return (
      <li key={node.id}>
        <div
          className={`lib-row ${selected ? 'is-selected' : ''} ${dropTarget === node.id ? 'is-drop' : ''} lib-row-${node.type}`}
          style={{ paddingInlineStart: `${depth * 0.85 + 0.35}rem` }}
          draggable
          onDragStart={(e) => {
            e.stopPropagation()
            setDragId(node.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(e) => {
            if (!dragId || dragId === node.id) return
            e.preventDefault()
            setDropTarget(node.id)
          }}
          onDragLeave={() => setDropTarget((t) => (t === node.id ? null : t))}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void handleDrop(node)
          }}
          onDragEnd={() => {
            setDragId(null)
            setDropTarget(null)
          }}
          onContextMenu={(e) => {
            if (!onContextMenu) return
            e.preventDefault()
            onContextMenu(node, e)
          }}
        >
          {isContainer || children.length > 0 ? (
            <button
              type="button"
              className="lib-caret"
              aria-label={expanded ? 'Collapse' : 'Expand'}
              aria-expanded={expanded}
              onClick={(e) => {
                e.stopPropagation()
                void toggleExpanded(node.id, expanded)
              }}
            >
              <Icon name="chevron-right" className={`h-3 w-3 ${expanded ? 'rotate-90' : ''}`} />
            </button>
          ) : (
            <span className="lib-caret" aria-hidden />
          )}

          <button
            type="button"
            className="lib-label"
            onClick={() => void openNode(node.id)}
            title={[node.title, node.arabicTitle].filter(Boolean).join(' — ')}
          >
            <Icon name={ICONS[node.type]} className="lib-icon" />
            <NodeTitle node={node} />
            {node.favorite && <Icon name="star" className="lib-star" />}
          </button>

          {onAdd && isContainer && (
            <button
              type="button"
              className="lib-add"
              aria-label={`Add to ${node.title}`}
              title="Add"
              onClick={(e) => {
                e.stopPropagation()
                onAdd(node)
              }}
            >
              <Icon name="plus" className="h-3 w-3" />
            </button>
          )}
        </div>

        {expanded && children.length > 0 && (
          <ul>{children.map((child) => renderNode(child, depth + 1))}</ul>
        )}
      </li>
    )
  }

  const roots = byParent.get(null) ?? []

  if (roots.length === 0) {
    return (
      <p className="text-ink-faint px-3 py-4 text-xs">
        Your library is being prepared…
      </p>
    )
  }

  return (
    <ul className={`lib-tree lib-tree-${variant}`}>{roots.map((node) => renderNode(node, 0))}</ul>
  )
}
