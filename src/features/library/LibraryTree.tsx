import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { libraryRepo } from '@/db/repos/libraryTree'
import {
  canNestUnder,
  canSitAtRoot,
  childTypeFor,
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
 * Drafts are UI-only until a non-empty title is committed. Empty / cancelled
 * drafts never touch IndexedDB. Depth only changes indentation.
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

/** Ephemeral create row — not a LibraryNode until committed. */
interface DraftSession {
  kind: 'draft'
  parentId: string
  /** Insert after this sibling, or at end when null. */
  afterId: string | null
  type: LibraryNodeType
  text: string
}

/** In-place rename of an existing node. */
interface RenameSession {
  kind: 'rename'
  nodeId: string
  arabic: boolean
  text: string
  snapshot: { title: string; arabicTitle?: string }
}

type EditSession = DraftSession | RenameSession

interface TreeProps {
  variant: 'home' | 'sidebar'
  onContextMenu?: (node: LibraryNode, event: React.MouseEvent) => void
  outline?: OutlineEntry[]
  onOutlineJump?: (blockId: string) => void
  suppressEmpty?: boolean
  renameRequest?: { id: string; arabic?: boolean } | null
  onRenameRequestHandled?: () => void
}

const OUTLINE_LIMIT = 8

export function LibraryTree({
  variant,
  onContextMenu,
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
  const [session, setSession] = useState<EditSession | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const ignoreBlur = useRef(false)
  const sessionRef = useRef<EditSession | null>(null)
  /** Serializes Enter/Tab commits so rapid outline typing cannot double-submit or drop. */
  const commitChain = useRef(Promise.resolve())
  // sessionRef is updated only via helpers — never overwritten from render.

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

  const beginRename = useCallback((node: LibraryNode, arabic = false) => {
    const next: RenameSession = {
      kind: 'rename',
      nodeId: node.id,
      arabic,
      text: arabic ? (node.arabicTitle ?? '') : node.title,
      snapshot: { title: node.title, arabicTitle: node.arabicTitle },
    }
    sessionRef.current = next
    setSession(next)
  }, [])

  const beginDraft = useCallback(async (parent: LibraryNode, afterId: string | null = null) => {
    const type = childTypeFor(parent.type)
    if (!type) return
    // Already drafting under this parent — just focus.
    if (
      sessionRef.current?.kind === 'draft' &&
      sessionRef.current.parentId === parent.id
    ) {
      ignoreBlur.current = true
      inputRef.current?.focus()
      requestAnimationFrame(() => {
        ignoreBlur.current = false
      })
      return
    }
    await libraryRepo.update(parent.id, { collapsed: false })
    const next: DraftSession = {
      kind: 'draft',
      parentId: parent.id,
      afterId,
      type,
      text: '',
    }
    sessionRef.current = next
    setSession(next)
  }, [])

  /** Notion-style: open an empty outline line under a parent without requiring +. */
  const startWritingUnder = useCallback(
    async (parent: LibraryNode) => {
      if (childTypeFor(parent.type) === null) return
      const kids = byParent.get(parent.id) ?? []
      const last = kids[kids.length - 1]
      await beginDraft(parent, last?.id ?? null)
    },
    [beginDraft, byParent],
  )

  useEffect(() => {
    if (!renameRequest) return
    const node = byId.get(renameRequest.id)
    if (!node) return
    beginRename(node, !!renameRequest.arabic)
    onRenameRequestHandled?.()
  }, [renameRequest, byId, onRenameRequestHandled, beginRename])

  useEffect(() => {
    if (!session) return
    ignoreBlur.current = true
    inputRef.current?.focus()
    requestAnimationFrame(() => {
      ignoreBlur.current = false
    })
  }, [session])

  // Drop ephemeral draft/rename on unmount so blur cannot race the next test or route.
  useEffect(() => {
    return () => {
      ignoreBlur.current = true
      sessionRef.current = null
    }
  }, [])

  const updateSessionText = (text: string) => {
    const prev = sessionRef.current
    if (!prev) return
    const next = { ...prev, text }
    sessionRef.current = next
    setSession(next)
  }

  const clearSession = () => {
    sessionRef.current = null
    setSession(null)
    ignoreBlur.current = false
  }

  /** Persist a draft title as a real node; returns the new id. */
  const persistDraft = async (draft: DraftSession, title: string): Promise<LibraryNode> => {
    const siblings = await libraryRepo.children(draft.parentId)
    const afterIndex = draft.afterId
      ? siblings.findIndex((s) => s.id === draft.afterId)
      : siblings.length - 1
    const node = await libraryRepo.create({
      parentId: draft.parentId,
      type: draft.type,
      title,
    })
    const index = Math.max(0, afterIndex + 1)
    await libraryRepo.move(node.id, draft.parentId, index)
    return node
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
    } else if (!canSitAtRoot(node.type)) {
      return
    }
    const uncleSiblings = await libraryRepo.children(grandParentId)
    const parentIndex = uncleSiblings.findIndex((n) => n.id === parent.id)
    await libraryRepo.move(node.id, grandParentId, parentIndex + 1)
  }

  const focusPreviousTitle = async (parentId: string | null, afterId: string | null) => {
    if (!parentId) {
      clearSession()
      return
    }
    const siblings = await libraryRepo.children(parentId)
    if (afterId) {
      const prev = siblings.find((s) => s.id === afterId)
      if (prev) {
        beginRename(prev)
        return
      }
    }
    const last = siblings[siblings.length - 1]
    if (last) beginRename(last)
    else clearSession()
  }

  const runCommit = (job: () => Promise<void>) => {
    ignoreBlur.current = true
    const next = commitChain.current.then(job).catch(() => undefined)
    commitChain.current = next
    void next.finally(() => {
      if (commitChain.current !== next) return
      requestAnimationFrame(() => {
        if (commitChain.current === next) ignoreBlur.current = false
      })
    })
    return next
  }

  const commitSession = (opts: {
    nextSibling: boolean
    cancel: boolean
    focusPrevious?: boolean
    rawText?: string
  }) => {
    // Capture at queue time — the input may remount before the job runs.
    const queuedText = opts.rawText ?? sessionRef.current?.text ?? ''
    return runCommit(async () => {
      const current = sessionRef.current
      if (!current) return

      const liveText =
        (inputRef.current?.value && inputRef.current.value.length > 0
          ? inputRef.current.value
          : null) ??
        (queuedText.length > 0 ? queuedText : null) ??
        current.text

      if (current.kind === 'draft') {
        if (opts.cancel) {
          const { parentId, afterId } = current
          clearSession()
          if (opts.focusPrevious) await focusPreviousTitle(parentId, afterId)
          return
        }

        if (!liveText.trim()) {
          clearSession()
          return
        }

        const draft = { ...current }
        const title = liveText.trim()
        const parentId = draft.parentId

        if (opts.nextSibling) {
          const pending: DraftSession = {
            kind: 'draft',
            parentId,
            afterId: draft.afterId,
            type: draft.type,
            text: '',
          }
          sessionRef.current = pending
          setSession(pending)
        } else {
          sessionRef.current = null
          setSession(null)
        }

        const created = await persistDraft(draft, title)

        if (opts.nextSibling) {
          const latest = sessionRef.current
          const next: DraftSession = {
            kind: 'draft',
            parentId,
            afterId: created.id,
            type: draft.type,
            text:
              latest?.kind === 'draft' && latest.parentId === parentId ? latest.text : '',
          }
          sessionRef.current = next
          setSession(next)
        }
        return
      }

      const node = await libraryRepo.get(current.nodeId)
      if (!node) {
        clearSession()
        return
      }

      if (opts.cancel) {
        await libraryRepo.update(node.id, {
          title: current.snapshot.title,
          arabicTitle: current.snapshot.arabicTitle,
        })
        clearSession()
        return
      }

      const value = liveText.trim()
      if (current.arabic) {
        await libraryRepo.update(node.id, { arabicTitle: value || undefined })
        clearSession()
        return
      }

      if (!value) {
        clearSession()
        return
      }

      await libraryRepo.update(node.id, { title: value })

      if (opts.nextSibling && node.parentId) {
        const parent = await libraryRepo.get(node.parentId)
        const type = parent ? childTypeFor(parent.type) : null
        if (parent && type) {
          const latest = sessionRef.current
          const next: DraftSession = {
            kind: 'draft',
            parentId: parent.id,
            afterId: node.id,
            type,
            text:
              latest?.kind === 'draft' && latest.parentId === parent.id ? latest.text : '',
          }
          sessionRef.current = next
          setSession(next)
          return
        }
      }
      clearSession()
    })
  }

  const handleTab = (shift: boolean, rawText?: string) =>
    runCommit(async () => {
      const current = sessionRef.current
      if (!current) return

      if (current.kind === 'draft') {
        const title = (rawText ?? current.text).trim()
        if (!title) {
          requestAnimationFrame(() => {
            inputRef.current?.focus()
          })
          return
        }
        sessionRef.current = null
        setSession(null)
        const created = await persistDraft(current, title)
        if (shift) await outdent(created)
        else await indent(created)
        const fresh = await libraryRepo.get(created.id)
        if (fresh) beginRename(fresh)
        return
      }

      const value = (rawText ?? current.text).trim()
      if (current.arabic) {
        await libraryRepo.update(current.nodeId, { arabicTitle: value || undefined })
      } else if (value) {
        await libraryRepo.update(current.nodeId, { title: value })
      }
      const fresh = await libraryRepo.get(current.nodeId)
      if (fresh) {
        if (shift) await outdent(fresh)
        else await indent(fresh)
        const moved = await libraryRepo.get(current.nodeId)
        if (moved) beginRename(moved, current.arabic)
      }
    })

  const handleDrop = useCallback(
    async (target: LibraryNode) => {
      if (!dragId || dragId === target.id || !nodes) return
      const dragged = nodes.find((n) => n.id === dragId)
      if (!dragged) return
      if (canNestUnder(dragged.type, target.type)) {
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

  const renderEditor = (opts: {
    depth: number
    text: string
    arabic: boolean
    onChange: (value: string) => void
    showCaret: boolean
    expanded?: boolean
  }) => (
    <div
      className="lib-row is-editing"
      style={{ paddingInlineStart: `${opts.depth * 0.85 + 0.35}rem` }}
    >
      {opts.showCaret ? (
        <span className="lib-caret" aria-hidden>
          <Icon name="chevron-right" className={`h-3 w-3 ${opts.expanded ? 'rotate-90' : ''}`} />
        </span>
      ) : (
        <span className="lib-caret" aria-hidden />
      )}
      <input
        ref={inputRef}
        className={`lib-inline-input ${opts.arabic ? 'font-arabic' : ''}`}
        dir={opts.arabic ? 'rtl' : 'auto'}
        value={opts.text}
        placeholder=""
        aria-label={opts.arabic ? 'Arabic title' : 'Title'}
        onChange={(e) => opts.onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          const rawText = (e.currentTarget as HTMLInputElement).value
          if (e.key === 'Enter') {
            e.preventDefault()
            ignoreBlur.current = true
            void commitSession({
              nextSibling: !opts.arabic,
              cancel: false,
              rawText,
            })
          } else if (e.key === 'Escape') {
            e.preventDefault()
            ignoreBlur.current = true
            void commitSession({ nextSibling: false, cancel: true, rawText })
          } else if (e.key === 'Tab') {
            e.preventDefault()
            void handleTab(e.shiftKey, rawText)
          } else if (e.key === 'Backspace' && rawText === '' && !opts.arabic) {
            e.preventDefault()
            ignoreBlur.current = true
            void commitSession({
              nextSibling: false,
              cancel: true,
              focusPrevious: true,
              rawText,
            })
          }
        }}
        onBlur={() => {
          if (ignoreBlur.current) return
          void commitSession({
            nextSibling: false,
            cancel: false,
            rawText: inputRef.current?.value,
          })
        }}
      />
    </div>
  )

  const renderDraftRow = (parent: LibraryNode, depth: number) => {
    if (!session || session.kind !== 'draft' || session.parentId !== parent.id) return null
    return (
      <li key="__draft__">
        {renderEditor({
          depth: depth + 1,
          text: session.text,
          arabic: false,
          onChange: updateSessionText,
          showCaret: false,
        })}
      </li>
    )
  }

  const renderNode = (node: LibraryNode, depth: number): React.ReactNode => {
    const children = byParent.get(node.id) ?? []
    const isContainer = isContainerType(node.type)
    const expanded = !node.collapsed
    const selected = activeNodeId === node.id
    const canAdd = childTypeFor(node.type) !== null
    const renaming =
      session?.kind === 'rename' && session.nodeId === node.id ? session : null
    const showChildren = expanded || (session?.kind === 'draft' && session.parentId === node.id)

    return (
      <li key={node.id}>
        {renaming ? (
          renderEditor({
            depth,
            text: renaming.text,
            arabic: renaming.arabic,
            onChange: updateSessionText,
            showCaret: isContainer || children.length > 0,
            expanded,
          })
        ) : (
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
            {isContainer || children.length > 0 || canAdd ? (
              <button
                type="button"
                className="lib-caret"
                aria-label={expanded ? 'Collapse' : 'Expand'}
                aria-expanded={expanded}
                onClick={(e) => {
                  e.stopPropagation()
                  const collapsing = expanded
                  void toggleExpanded(node.id, expanded)
                  if (collapsing) {
                    // Drop an empty in-progress line when closing the parent.
                    if (
                      sessionRef.current?.kind === 'draft' &&
                      sessionRef.current.parentId === node.id &&
                      !sessionRef.current.text.trim()
                    ) {
                      clearSession()
                    }
                  } else if (canAdd && children.length === 0) {
                    // Notion toggle: open → ready to type. No + required.
                    void beginDraft(node, null)
                  }
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
              onClick={() => {
                // Empty book/folder/etc.: expand and type like a Notion toggle.
                // Study items (chapters…) still open Study on click.
                if (canAdd && children.length === 0 && isContainerType(node.type)) {
                  void beginDraft(node, null)
                  return
                }
                void openNode(node.id)
              }}
              onDoubleClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                beginRename(node)
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.shiftKey) return
                e.preventDefault()
                e.stopPropagation()
                // Notion outline: Enter starts a new line at this level (sibling).
                // To write inside an empty item, expand or click the container.
                if (node.parentId) {
                  const parent = byId.get(node.parentId)
                  if (parent && childTypeFor(parent.type)) {
                    void beginDraft(parent, node.id)
                    return
                  }
                }
                if (canAdd) void startWritingUnder(node)
              }}
              title={[node.title, node.arabicTitle].filter(Boolean).join(' — ') || 'Untitled'}
            >
              {node.type === 'book' && <Icon name={ICONS.book} className="lib-icon" />}
              <NodeTitle node={node} />
              {node.favorite && <Icon name="star" className="lib-star" />}
            </button>

            {canAdd && (
              <button
                type="button"
                className="lib-add"
                aria-label={`Add under ${node.title || 'item'}`}
                title="Add"
                onClick={(e) => {
                  e.stopPropagation()
                  void startWritingUnder(node)
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
        )}

        {selected && outline && outline.length > 0 && (
          <Outline
            entries={outline}
            depth={depth + 1}
            onJump={onOutlineJump}
            collapsed={outlineCollapsed}
            onToggleCollapsed={() => setOutlineCollapsed((v) => !v)}
          />
        )}

        {showChildren && (
          <ul>
            {children.map((child) => (
              <Fragment key={child.id}>
                {renderNode(child, depth + 1)}
                {session?.kind === 'draft' &&
                  session.parentId === node.id &&
                  session.afterId === child.id &&
                  renderDraftRow(node, depth)}
              </Fragment>
            ))}
            {session?.kind === 'draft' &&
              session.parentId === node.id &&
              (session.afterId === null ||
                !children.some((c) => c.id === session.afterId)) &&
              renderDraftRow(node, depth)}
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

export type { LibraryNode }
