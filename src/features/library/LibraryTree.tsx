import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { libraryRepo } from '@/db/repos/libraryTree'
import {
  canNestUnder,
  childTypeFor,
  isBlankTitle,
  isContainerType,
  previousSibling,
} from '@/features/library/libraryOutline'
import { Icon, type IconName } from '@/features/shell/Icon'
import { useLibraryStore } from '@/state/useLibraryStore'
import type { OutlineEntry } from '@/services/notes/NotesService'
import type { LibraryNode, LibraryNodeType } from '@/types'

/**
 * The library tree — Notion-like outline editing over real LibraryNodes.
 *
 * Click navigates. Double-click / Rename edits inline. Enter creates the next
 * sibling. Tab / Shift+Tab indent within structural rules. Empty Backspace
 * removes only blank draft rows.
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

export function NodeTitle({
  node,
  className = '',
}: {
  node: Pick<LibraryNode, 'title' | 'arabicTitle' | 'type'>
  className?: string
}) {
  const hasBoth = !!node.title && !!node.arabicTitle
  const displayTitle = node.title || (node.arabicTitle ? '' : 'Untitled')
  return (
    <span className={`lib-title ${className}`}>
      {displayTitle && <bdi className="lib-title-latin">{displayTitle}</bdi>}
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
  variant: 'home' | 'sidebar'
  onContextMenu?: (node: LibraryNode, event: React.MouseEvent) => void
  /** Optional external add — prefer the tree's own inline create. */
  onAdd?: (node: LibraryNode) => void
  outline?: OutlineEntry[]
  onOutlineJump?: (blockId: string) => void
  suppressEmpty?: boolean
  /** Ask the tree to begin inline rename (e.g. from a context menu). */
  renameRequest?: { id: string; arabic?: boolean } | null
  onRenameRequestHandled?: () => void
}

const OUTLINE_LIMIT = 8

export function LibraryTree({
  variant,
  onContextMenu,
  onAdd,
  outline,
  onOutlineJump,
  suppressEmpty = false,
  renameRequest,
  onRenameRequestHandled,
}: TreeProps) {
  const nodes = useLiveQuery(() => libraryRepo.all(), [])
  const activeNodeId = useLibraryStore((s) => s.activeNodeId)
  const openNode = useLibraryStore((s) => s.openNode)
  const toggleExpanded = useLibraryStore((s) => s.toggleExpanded)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [outlineCollapsed, setOutlineCollapsed] = useState(false)

  /** Row currently being edited (rename or fresh blank). */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [draftArabic, setDraftArabic] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  /** Snapshot for Escape cancel on rename. */
  const editSnapshot = useRef<{ title: string; arabicTitle?: string } | null>(null)
  /** Ids created this session that are still blank drafts. */
  const draftIds = useRef(new Set<string>())
  /** Suppress blur-commit when Enter/Tab/Escape already handled the edit. */
  const ignoreBlur = useRef(false)

  const byParent = useMemo(() => {
    const map = new Map<string | null, LibraryNode[]>()
    for (const node of nodes ?? []) {
      const list = map.get(node.parentId) ?? []
      list.push(node)
      map.set(node.parentId, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order)
    return map
  }, [nodes])

  const byId = useMemo(() => {
    const map = new Map<string, LibraryNode>()
    for (const node of nodes ?? []) map.set(node.id, node)
    return map
  }, [nodes])

  const beginEdit = useCallback((node: LibraryNode, arabic = false) => {
    editSnapshot.current = { title: node.title, arabicTitle: node.arabicTitle }
    setDraftArabic(arabic)
    setDraft(arabic ? (node.arabicTitle ?? '') : node.title)
    setEditingId(node.id)
  }, [])

  useEffect(() => {
    if (!renameRequest) return
    const node = byId.get(renameRequest.id)
    if (!node) return
    beginEdit(node, !!renameRequest.arabic)
    onRenameRequestHandled?.()
  }, [renameRequest, byId, onRenameRequestHandled, beginEdit])

  useEffect(() => {
    if (editingId) inputRef.current?.focus()
  }, [editingId, draftArabic])

  const createChild = async (parent: LibraryNode, afterId?: string | null) => {
    const type = childTypeFor(parent.type)
    if (!type) return
    await libraryRepo.update(parent.id, { collapsed: false })
    // Read siblings from the DB — render-time maps can lag a live-query tick.
    const siblings = await libraryRepo.children(parent.id)
    const afterIndex = afterId ? siblings.findIndex((s) => s.id === afterId) : siblings.length - 1
    const node = await libraryRepo.create({ parentId: parent.id, type, title: '' })
    const index = Math.max(0, afterIndex + 1)
    await libraryRepo.move(node.id, parent.id, index)
    draftIds.current.add(node.id)
    editSnapshot.current = { title: '', arabicTitle: undefined }
    setDraftArabic(false)
    setDraft('')
    setEditingId(node.id)
  }

  const commitEdit = async (opts: {
    nextSibling: boolean
    cancel: boolean
    /** Only Backspace should destroy an empty draft — blur must not. */
    removeIfEmpty?: boolean
  }) => {
    if (!editingId) return
    const node = byId.get(editingId)
    if (!node) {
      setEditingId(null)
      return
    }

    if (opts.cancel) {
      if (draftIds.current.has(node.id) && isBlankTitle(node.title) && !node.arabicTitle) {
        draftIds.current.delete(node.id)
        await libraryRepo.remove(node.id, { deleteNotes: true })
      } else if (editSnapshot.current) {
        await libraryRepo.update(node.id, {
          title: editSnapshot.current.title,
          arabicTitle: editSnapshot.current.arabicTitle,
        })
      }
      setEditingId(null)
      return
    }

    const value = draft.trim()
    if (draftArabic) {
      await libraryRepo.update(node.id, { arabicTitle: value || undefined })
      draftIds.current.delete(node.id)
      setEditingId(null)
      return
    }

    if (!value) {
      if (opts.removeIfEmpty && draftIds.current.has(node.id)) {
        draftIds.current.delete(node.id)
        const prevId = previousSibling(node, byParent.get(node.parentId) ?? [])?.id
        await libraryRepo.remove(node.id, { deleteNotes: true })
        setEditingId(null)
        if (prevId) {
          const prev = byId.get(prevId)
          if (prev) beginEdit(prev)
        }
        return
      }
      // Blur / Enter on empty: leave the blank row; do not auto-delete.
      setEditingId(null)
      return
    }

    await libraryRepo.update(node.id, { title: value })
    draftIds.current.delete(node.id)
    setEditingId(null)

    if (opts.nextSibling) {
      if (node.parentId) {
        const parent = byId.get(node.parentId)
        if (parent) await createChild(parent, node.id)
      }
    }
  }

  const indent = async (node: LibraryNode) => {
    const siblings = await libraryRepo.children(node.parentId)
    const prev = previousSibling(node, siblings)
    if (!prev) return
    if (!canNestUnder(node.type, prev.type)) return
    const children = await libraryRepo.children(prev.id)
    await libraryRepo.update(prev.id, { collapsed: false })
    await libraryRepo.move(node.id, prev.id, children.length)
  }

  const outdent = async (node: LibraryNode) => {
    if (!node.parentId) return
    const parent = await libraryRepo.get(node.parentId)
    if (!parent) return
    const grandParentId = parent.parentId
    if (grandParentId !== null) {
      const grand = await libraryRepo.get(grandParentId)
      if (!grand || !canNestUnder(node.type, grand.type)) return
    } else if (!(node.type === 'science' || node.type === 'folder' || node.type === 'book')) {
      // Only top-level-capable types may sit at the root.
      return
    }
    const uncleSiblings = await libraryRepo.children(grandParentId)
    const parentIndex = uncleSiblings.findIndex((n) => n.id === parent.id)
    await libraryRepo.move(node.id, grandParentId, parentIndex + 1)
  }

  const handleDrop = useCallback(
    async (target: LibraryNode) => {
      if (!dragId || dragId === target.id || !nodes) return
      const dragged = nodes.find((n) => n.id === dragId)
      if (!dragged) return
      if (isContainerType(target.type) && canNestUnder(dragged.type, target.type)) {
        const children = byParent.get(target.id) ?? []
        await libraryRepo.move(dragId, target.id, children.length)
        await libraryRepo.update(target.id, { collapsed: false })
      } else {
        const siblings = byParent.get(target.parentId) ?? []
        await libraryRepo.move(
          dragId,
          target.parentId,
          siblings.findIndex((n) => n.id === target.id),
        )
      }
      setDragId(null)
      setDropTarget(null)
    },
    [dragId, nodes, byParent],
  )

  const renderNode = (node: LibraryNode, depth: number): React.ReactNode => {
    const children = byParent.get(node.id) ?? []
    const isContainer = isContainerType(node.type)
    const expanded = !node.collapsed
    const selected = activeNodeId === node.id
    const editing = editingId === node.id
    const canAdd = childTypeFor(node.type) !== null

    return (
      <li key={node.id}>
        <div
          className={`lib-row ${selected ? 'is-selected' : ''} ${dropTarget === node.id ? 'is-drop' : ''} ${editing ? 'is-editing' : ''} lib-row-${node.type}`}
          style={{ paddingInlineStart: `${depth * 0.85 + 0.35}rem` }}
          draggable={!editing}
          onDragStart={(e) => {
            if (editing) return
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

          {editing ? (
            <input
              ref={inputRef}
              className={`lib-inline-input ${draftArabic ? 'font-arabic' : ''}`}
              dir={draftArabic ? 'rtl' : 'auto'}
              value={draft}
              placeholder={draftArabic ? 'Arabic title' : 'Untitled'}
              aria-label={draftArabic ? 'Arabic title' : 'Title'}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ignoreBlur.current = true
                  void commitEdit({ nextSibling: !draftArabic, cancel: false })
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  ignoreBlur.current = true
                  void commitEdit({ nextSibling: false, cancel: true })
                } else if (e.key === 'Tab') {
                  e.preventDefault()
                  ignoreBlur.current = true
                  void (async () => {
                    const value = draft.trim()
                    if (draftArabic) {
                      await libraryRepo.update(node.id, { arabicTitle: value || undefined })
                    } else if (value) {
                      await libraryRepo.update(node.id, { title: value })
                      draftIds.current.delete(node.id)
                    }
                    // Re-read after save — the render closure's parentId goes stale after indent.
                    const fresh = await libraryRepo.get(node.id)
                    if (fresh) {
                      if (e.shiftKey) await outdent(fresh)
                      else await indent(fresh)
                    }
                    setEditingId(node.id)
                    requestAnimationFrame(() => {
                      ignoreBlur.current = false
                      inputRef.current?.focus()
                    })
                  })()
                } else if (e.key === 'Backspace' && draft === '' && !draftArabic) {
                  e.preventDefault()
                  ignoreBlur.current = true
                  void commitEdit({ nextSibling: false, cancel: false, removeIfEmpty: true })
                }
              }}
              onBlur={() => {
                if (ignoreBlur.current) {
                  ignoreBlur.current = false
                  return
                }
                void commitEdit({ nextSibling: false, cancel: false })
              }}
            />
          ) : (
            <button
              type="button"
              className="lib-label"
              onClick={() => void openNode(node.id)}
              onDoubleClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                beginEdit(node)
              }}
              title={[node.title, node.arabicTitle].filter(Boolean).join(' — ') || 'Untitled'}
            >
              <Icon name={ICONS[node.type]} className="lib-icon" />
              <NodeTitle node={node} />
              {node.favorite && <Icon name="star" className="lib-star" />}
            </button>
          )}

          {canAdd && (
            <button
              type="button"
              className="lib-add"
              aria-label={`Add under ${node.title || 'item'}`}
              title="Add"
              onClick={(e) => {
                e.stopPropagation()
                if (onAdd && !isContainerType(node.type)) {
                  onAdd(node)
                  return
                }
                void createChild(node)
              }}
            >
              <Icon name="plus" className="h-3 w-3" />
            </button>
          )}
          {onContextMenu && (
            <button
              type="button"
              className="lib-more"
              aria-label="More"
              title="More"
              onClick={(e) => {
                e.stopPropagation()
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                onContextMenu(node, {
                  ...e,
                  clientX: rect.left,
                  clientY: rect.bottom,
                  preventDefault: () => undefined,
                } as React.MouseEvent)
              }}
            >
              ⋯
            </button>
          )}
        </div>

        {selected && outline && outline.length > 0 && (
          <Outline
            entries={outline}
            depth={depth + 1}
            onJump={onOutlineJump}
            collapsed={outlineCollapsed}
            onToggleCollapsed={() => setOutlineCollapsed((v) => !v)}
          />
        )}

        {expanded && (
          <ul>
            {children.map((child) => renderNode(child, depth + 1))}
            {canAdd && editingId === null && (
              <li>
                <button
                  type="button"
                  className="lib-composer"
                  style={{ paddingInlineStart: `${(depth + 1) * 0.85 + 0.35}rem` }}
                  onClick={() => void createChild(node)}
                >
                  <span className="lib-composer-mark" aria-hidden>
                    +
                  </span>
                  New {childTypeFor(node.type)}
                </button>
              </li>
            )}
          </ul>
        )}
      </li>
    )
  }

  const roots = byParent.get(null) ?? []

  if (nodes === undefined) {
    if (suppressEmpty) return null
    return (
      <p className="text-ink-faint px-3 py-4 text-xs">Your library is being prepared…</p>
    )
  }
  if (roots.length === 0) return null

  return (
    <ul className={`lib-tree lib-tree-${variant}`}>{roots.map((node) => renderNode(node, 0))}</ul>
  )
}

function Outline({
  entries,
  depth,
  onJump,
  collapsed,
  onToggleCollapsed,
}: {
  entries: OutlineEntry[]
  depth: number
  onJump?: (blockId: string) => void
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? entries : entries.slice(0, OUTLINE_LIMIT)
  const hidden = entries.length - shown.length

  return (
    <ul className="lib-outline">
      <li>
        <button
          type="button"
          className="lib-outline-head"
          style={{ paddingInlineStart: `${depth * 0.85 + 0.35}rem` }}
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
        >
          <Icon name="chevron-right" className={`h-2.5 w-2.5 ${collapsed ? '' : 'rotate-90'}`} />
          In this chapter
        </button>
      </li>

      {!collapsed &&
        shown.map((entry, index) => (
          <li key={`${entry.blockId}:${index}`}>
            <button
              type="button"
              className={`lib-outline-item ${entry.kind === 'heading' ? 'is-heading' : ''}`}
              style={{
                paddingInlineStart: `${depth * 0.85 + 1.15 + (entry.kind === 'heading' ? (entry.level - 1) * 0.5 : 0)}rem`,
              }}
              onClick={() => onJump?.(entry.blockId)}
              title={entry.text}
              dir="auto"
            >
              {entry.kind === 'toggle' && (
                <span className="lib-outline-mark" aria-hidden>
                  ▸
                </span>
              )}
              <span className="truncate">{entry.text}</span>
            </button>
          </li>
        ))}

      {!collapsed && hidden > 0 && (
        <li>
          <button
            type="button"
            className="lib-outline-more"
            style={{ paddingInlineStart: `${depth * 0.85 + 1.15}rem` }}
            onClick={() => setExpanded(true)}
          >
            {hidden} more…
          </button>
        </li>
      )}
    </ul>
  )
}

/** Exported for context menus that want inline rename without prompts. */
export type { LibraryNode }
