import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { libraryBlocksRepo, libraryPagesRepo } from '@/db/repos/libraryPages'
import { libraryRepo } from '@/db/repos/libraryTree'
import { LibraryBlockRow } from '@/features/library/LibraryBlockRow'
import {
  blockById,
  canMergeWith,
  childrenOf,
  filterLibraryBlocks,
  indentPlacement,
  isPersistableBlock,
  isTransientId,
  makeTransientBlock,
  mergeVisible,
  nextTransients,
  outdentPlacement,
  parentIdFromTransientId,
  reconcileTransients,
  slashQueryFrom,
  splitContent,
  stripSlashQuery,
  TRANSIENT_BLOCK_ID,
  transientIdFor,
  visibleBlockIds,
  type BlockDef,
} from '@/features/library/libraryPageModel'
import { ensureLibraryPageReady } from '@/features/library/migrateLibraryPages'
import { SlashCommandMenu } from '@/features/library/SlashCommandMenu'
import { Icon } from '@/features/shell/Icon'
import { useLibraryStore } from '@/state/useLibraryStore'
import type { LibraryBlock } from '@/types'

/**
 * Notion-style page editor for Library Home.
 *
 * New lines are siblings. An expanded empty toggle shows an ephemeral nested
 * editor — it is not persisted until the user types or picks a block type.
 */

type SlashState = {
  blockId: string
  query: string
  index: number
  mode: 'convert' | 'insert'
  top: number
  left: number
}

export function LibraryEditor({
  pageId,
  onOpenPage,
}: {
  pageId: string
  onOpenPage?: (id: string) => void
}) {
  const stored = useLiveQuery(() => libraryBlocksRepo.forPage(pageId), [pageId])
  const page = useLiveQuery(() => libraryPagesRepo.get(pageId), [pageId])
  const studyNodes = useLiveQuery(() => libraryRepo.all(), [])
  const openStudySession = useLibraryStore((s) => s.openStudySession)

  const [ready, setReady] = useState(false)
  const [title, setTitle] = useState('Library')
  const [transients, setTransients] = useState<Record<string, LibraryBlock>>({})
  const [focusId, setFocusId] = useState<string | null>(transientIdFor(null))
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [studyPickFor, setStudyPickFor] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const caretRef = useRef(0)
  const chain = useRef(Promise.resolve())
  const transientsRef = useRef<Record<string, LibraryBlock>>({})
  const omittedTransients = useRef(new Set<string>())
  transientsRef.current = transients

  const run = (job: () => Promise<void>) => {
    const next = chain.current.then(job).catch(() => undefined)
    chain.current = next
    return next
  }

  const live = () => mergeVisible(stored ?? [], Object.values(transientsRef.current))

  useEffect(() => {
    void ensureLibraryPageReady().then(() => setReady(true))
  }, [])

  useEffect(() => {
    omittedTransients.current = new Set()
    setTransients({})
    setDrafts({})
    setFocusId(transientIdFor(null))
    setSlash(null)
  }, [pageId])

  useEffect(() => {
    if (page?.title != null) setTitle(page.title)
  }, [page?.title])

  useEffect(() => {
    if (!ready || stored === undefined) return
    setTransients((current) => {
      const incoming = nextTransients(pageId, stored, current, omittedTransients.current)
      for (const id of [...omittedTransients.current]) {
        const parentId = parentIdFromTransientId(id)
        if (id === TRANSIENT_BLOCK_ID || (parentId && childrenOf(stored, parentId).length > 0)) {
          omittedTransients.current.delete(id)
        }
      }
      return reconcileTransients(current, incoming)
    })
  }, [ready, stored, pageId])

  const blocks = useMemo(
    () =>
      mergeVisible(stored ?? [], Object.values(transients)).map((block) =>
        drafts[block.id] != null ? { ...block, content: drafts[block.id]! } : block,
      ),
    [stored, transients, drafts],
  )

  useEffect(() => {
    if (!stored) return
    setDrafts((current) => {
      let changed = false
      const next = { ...current }
      for (const block of stored) {
        if (next[block.id] != null && next[block.id] === block.content) {
          delete next[block.id]
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [stored])

  const slashItems = useMemo(
    () => (slash ? filterLibraryBlocks(slash.query) : []),
    [slash],
  )

  const focus = (id: string) => setFocusId(id)

  const placeMenu = (blockId: string, mode: SlashState['mode'], query: string, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect()
    setSlash({
      blockId,
      mode,
      query,
      index: 0,
      top: rect.bottom + 6,
      left: rect.left,
    })
  }

  const writeTitle = (value: string) => {
    setTitle(value)
    void libraryPagesRepo.updateTitle(pageId, value)
  }

  const putTransient = (block: LibraryBlock) => {
    omittedTransients.current.delete(block.id)
    setTransients((current) => ({ ...current, [block.id]: block }))
  }

  const dropTransient = (id: string) => {
    omittedTransients.current.add(id)
    setTransients((current) => {
      if (!current[id]) return current
      const { [id]: _omit, ...rest } = current
      return rest
    })
    setDrafts((current) => {
      if (current[id] == null) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  const persistTransient = async (block: LibraryBlock): Promise<LibraryBlock> => {
    const created = await libraryBlocksRepo.create({
      pageId: block.pageId,
      parentBlockId: block.parentBlockId,
      type: block.type,
      content: block.content,
      order: block.order,
      expanded: block.expanded,
      checked: block.checked,
      libraryNodeId: block.libraryNodeId,
      targetPageId: block.targetPageId,
    })
    dropTransient(block.id)
    return created
  }

  const ensurePersisted = async (block: LibraryBlock): Promise<LibraryBlock> => {
    if (!isTransientId(block.id)) return block
    if (!isPersistableBlock(block)) return block
    return persistTransient(block)
  }

  const onChange = (id: string, content: string, caret: number) => {
    caretRef.current = caret
    setDrafts((current) => ({ ...current, [id]: content }))
    const query = slashQueryFrom(content)
    if (query !== null) {
      const safe = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/:/g, '\\:')
      const el = document.querySelector(`[data-block-id="${safe}"]`) as HTMLElement | null
      if (el) placeMenu(id, 'convert', query, el)
    } else {
      setSlash((s) => (s?.blockId === id && s.mode === 'convert' ? null : s))
    }

    void run(async () => {
      const current = isTransientId(id)
        ? transientsRef.current[id]
        : blockById(live(), id)
      if (!current) return

      if (isTransientId(id)) {
        const next = { ...current, content }
        if (!isPersistableBlock(next)) {
          putTransient(next)
          return
        }
        const created = await persistTransient(next)
        setDrafts((d) => {
          const { [id]: _omit, ...rest } = d
          return { ...rest, [created.id]: content }
        })
        setFocusId(created.id)
        return
      }

      await libraryBlocksRepo.update(id, { content })
    })
  }

  const applyType = async (current: LibraryBlock, def: BlockDef, content: string) => {
    let targetPageId = current.targetPageId
    if (def.id === 'page' && !targetPageId) {
      const child = await libraryPagesRepo.create({
        title: content.trim() || 'Page',
        parentPageId: pageId,
      })
      targetPageId = child.id
    }
    const patch = {
      type: def.id,
      content,
      expanded: def.id === 'toggle' ? current.expanded : false,
      targetPageId,
    }
    if (isTransientId(current.id)) {
      const next = { ...current, ...patch }
      if (!isPersistableBlock(next) && def.id === 'text') {
        putTransient(next)
        setFocusId(current.id)
        return current.id
      }
      const created = await persistTransient(next)
      setDrafts((d) => ({ ...d, [created.id]: content }))
      if (def.id === 'study') setStudyPickFor(created.id)
      setFocusId(created.id)
      return created.id
    }
    await libraryBlocksRepo.update(current.id, patch)
    setDrafts((d) => ({ ...d, [current.id]: content }))
    if (def.id === 'study') setStudyPickFor(current.id)
    setFocusId(current.id)
    return current.id
  }

  const convertOrInsert = async (def: BlockDef) => {
    if (!slash) return
    const { blockId, mode } = slash
    setSlash(null)
    const current = blockById(live(), blockId) ?? transientsRef.current[blockId]
    if (!current) return

    const emptyDraft = isTransientId(current.id) && !current.content.trim()
    if (mode === 'insert' && !emptyDraft) {
      const siblings = childrenOf(live(), current.parentBlockId)
      const index = siblings.findIndex((row) => row.id === current.id) + 1
      if (def.id === 'text') {
        const next = makeTransientBlock(pageId, current.parentBlockId, index)
        putTransient(next)
        setFocusId(next.id)
        return
      }
      const created = await libraryBlocksRepo.create({
        pageId,
        parentBlockId: current.parentBlockId,
        type: def.id,
        content: '',
        order: index,
        expanded: def.id === 'toggle' ? false : undefined,
        targetPageId:
          def.id === 'page'
            ? (await libraryPagesRepo.create({ title: 'Page', parentPageId: pageId })).id
            : undefined,
      })
      if (def.id === 'study') setStudyPickFor(created.id)
      setFocusId(created.id)
      return
    }

    const content = stripSlashQuery(drafts[current.id] ?? current.content)
    await applyType(current, def, content)
  }

  const enter = async (block: LibraryBlock, caret: number) => {
    const { before, after } = splitContent(block.content, caret)
    if (isTransientId(block.id) && !before.trim() && !after.trim()) return

    if (!before.trim() && after.trim()) {
      const liveBlock = isTransientId(block.id)
        ? await ensurePersisted({ ...block, content: after })
        : block
      if (isTransientId(liveBlock.id)) {
        putTransient({ ...block, content: after })
        return
      }
      const next = makeTransientBlock(pageId, liveBlock.parentBlockId, liveBlock.order)
      putTransient(next)
      await libraryBlocksRepo.move(liveBlock.id, liveBlock.parentBlockId, liveBlock.order + 1)
      setFocusId(next.id)
      return
    }

    const liveBlock = await ensurePersisted({ ...block, content: before })
    if (isTransientId(liveBlock.id)) {
      putTransient({ ...block, content: before })
      return
    }
    if (block.content !== before) {
      await libraryBlocksRepo.update(liveBlock.id, { content: before })
      setDrafts((d) => ({ ...d, [liveBlock.id]: before }))
    }

    const siblings = childrenOf(
      mergeVisible(await libraryBlocksRepo.forPage(pageId), Object.values(transientsRef.current)),
      liveBlock.parentBlockId,
    )
    const index = siblings.findIndex((row) => row.id === liveBlock.id) + 1
    if (!after.trim()) {
      const next = makeTransientBlock(pageId, liveBlock.parentBlockId, index)
      putTransient(next)
      setFocusId(next.id)
      return
    }
    const created = await libraryBlocksRepo.create({
      pageId,
      parentBlockId: liveBlock.parentBlockId,
      type: 'text',
      content: after,
      order: index,
    })
    setDrafts((d) => ({ ...d, [created.id]: after }))
    setFocusId(created.id)
  }

  const backspaceStart = async (block: LibraryBlock, snapshot: LibraryBlock[] = live()) => {
    const all = snapshot
    const siblings = childrenOf(all, block.parentBlockId)
    const siblingIndex = siblings.findIndex((row) => row.id === block.id)
    const prevSibling = siblingIndex > 0 ? siblings[siblingIndex - 1] : null
    const visible = visibleBlockIds(all)
    const at = visible.indexOf(block.id)
    const prevId = prevSibling?.id ?? (at > 0 ? visible[at - 1] : null)
    const prev = prevId ? blockById(all, prevId) : undefined

    if (isTransientId(block.id)) {
      if (!block.content) {
        const persistedKids = childrenOf(stored ?? [], block.parentBlockId)
        if (block.parentBlockId && persistedKids.length > 0) dropTransient(block.id)
        if (prev) setFocusId(prev.id)
        else if (block.parentBlockId) setFocusId(block.parentBlockId)
      }
      return
    }

    if (!block.content) {
      await libraryBlocksRepo.remove(block.id)
      if (prev) setFocusId(prev.id)
      else {
        setFocusId(transientIdFor(null))
      }
      return
    }

    if (prev && canMergeWith(prev, block)) {
      const joined = `${prev.content}${block.content}`
      if (isTransientId(prev.id)) {
        putTransient({ ...prev, content: joined })
      } else {
        await libraryBlocksRepo.update(prev.id, { content: joined })
      }
      await libraryBlocksRepo.remove(block.id)
      setFocusId(prev.id)
    }
  }

  const indent = async (block: LibraryBlock) => {
    const persisted = await ensurePersisted(block)
    if (isTransientId(persisted.id)) return
    const all = mergeVisible((await libraryBlocksRepo.forPage(pageId)) ?? [], Object.values(transientsRef.current))
    const placement = indentPlacement(persisted, all)
    if (!placement) return
    await libraryBlocksRepo.move(persisted.id, placement.parentBlockId, placement.order)
    const parent = await libraryBlocksRepo.get(placement.parentBlockId)
    if (parent?.type === 'toggle' && !parent.expanded) {
      await libraryBlocksRepo.update(parent.id, { expanded: true })
    }
    setFocusId(persisted.id)
  }

  const outdent = async (block: LibraryBlock) => {
    const persisted = await ensurePersisted(block)
    if (isTransientId(persisted.id)) return
    const all = mergeVisible(await libraryBlocksRepo.forPage(pageId), Object.values(transientsRef.current))
    const placement = outdentPlacement(persisted, all)
    if (!placement) return
    await libraryBlocksRepo.move(persisted.id, placement.parentBlockId, placement.order)
    setFocusId(persisted.id)
  }

  const onKeyDown = (id: string, event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const block = blockById(blocks, id) ?? transientsRef.current[id]
    if (!block) return

    if (slash && slash.blockId === id) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSlash((s) => s && { ...s, index: slashItems.length ? (s.index + 1) % slashItems.length : 0 })
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSlash((s) =>
          s && { ...s, index: slashItems.length ? (s.index - 1 + slashItems.length) % slashItems.length : 0 },
        )
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const item = slashItems[slash.index]
        if (item) void run(() => convertOrInsert(item))
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setSlash(null)
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        return
      }
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      if (isTransientId(block.id) && !block.content.trim()) {
        const persistedKids = childrenOf(stored ?? [], block.parentBlockId)
        if (block.parentBlockId && persistedKids.length > 0) dropTransient(block.id)
        const visible = visibleBlockIds(blocks)
        const at = visible.indexOf(block.id)
        const prev = at > 0 ? visible[at - 1] : block.parentBlockId
        if (prev) setFocusId(prev)
      }
      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      void run(() => (event.shiftKey ? outdent(block) : indent(block)))
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      const caret = event.currentTarget.selectionStart ?? caretRef.current
      void run(() => enter(block, caret))
      return
    }

    if (event.key === 'Backspace') {
      const start = event.currentTarget.selectionStart ?? 0
      const end = event.currentTarget.selectionEnd ?? 0
      if (start === 0 && end === 0) {
        event.preventDefault()
        void run(() => backspaceStart(block, blocks))
      }
      return
    }

    if (event.key === 'ArrowUp' && (event.currentTarget.selectionStart ?? 0) === 0) {
      event.preventDefault()
      const visible = visibleBlockIds(blocks)
      const at = visible.indexOf(block.id)
      if (at > 0) setFocusId(visible[at - 1]!)
      else setFocusId('title')
      return
    }

    if (
      event.key === 'ArrowDown' &&
      (event.currentTarget.selectionStart ?? 0) === event.currentTarget.value.length
    ) {
      event.preventDefault()
      const visible = visibleBlockIds(blocks)
      const at = visible.indexOf(block.id)
      if (at >= 0 && at < visible.length - 1) setFocusId(visible[at + 1]!)
    }
  }

  const onToggle = (id: string) => {
    void run(async () => {
      const block = blockById(live(), id)
      if (!block || block.type !== 'toggle') return
      await libraryBlocksRepo.update(id, { expanded: !block.expanded })
    })
  }

  const onInsert = (id: string, anchor: HTMLElement) => {
    const current = blockById(blocks, id) ?? transientsRef.current[id]
    const mode = current && isTransientId(current.id) && !current.content.trim() ? 'convert' : 'insert'
    placeMenu(id, mode, '', anchor)
  }

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return
    void run(async () => {
      const all = await libraryBlocksRepo.forPage(pageId)
      const dragged = blockById(all, dragId)
      const target = blockById(all, targetId)
      if (!dragged || !target) return
      if (target.type === 'toggle') {
        await libraryBlocksRepo.update(target.id, { expanded: true })
        const kids = childrenOf(all, target.id).filter((row) => row.id !== dragged.id)
        await libraryBlocksRepo.move(dragged.id, target.id, kids.length)
      } else {
        const siblings = childrenOf(all, target.parentBlockId).filter((row) => row.id !== dragged.id)
        const index = siblings.findIndex((row) => row.id === target.id)
        await libraryBlocksRepo.move(dragged.id, target.parentBlockId, Math.max(0, index))
      }
      setDragId(null)
      setDropId(null)
      setFocusId(dragged.id)
    })
  }

  const activateTail = () => {
    const roots = childrenOf(blocks, null)
    const last = roots[roots.length - 1]
    const rootDraft = transientIdFor(null)
    if (last?.id === rootDraft) {
      setFocusId(rootDraft)
      return
    }
    if (last && last.type === 'text' && !last.content.trim()) {
      setFocusId(last.id)
      return
    }
    const next = makeTransientBlock(pageId, null, roots.length)
    putTransient(next)
    setFocusId(next.id)
  }

  const attachStudy = (blockId: string, nodeId: string, label: string) => {
    void run(async () => {
      await libraryBlocksRepo.update(blockId, { libraryNodeId: nodeId, content: label, type: 'study' })
      setStudyPickFor(null)
    })
  }

  const renderBranch = (parentId: string | null, depth: number): React.ReactNode => {
    const kids = childrenOf(blocks, parentId)
    if (kids.length === 0) return null
    return (
      <ul className="page-block-list">
        {kids.map((block) => (
          <li key={block.id}>
            <LibraryBlockRow
              block={block}
              blocks={blocks}
              depth={depth}
              focused={focusId === block.id}
              gutterOn={hoveredId === block.id || (focusId === block.id && hoveredId === null)}
              onHover={setHoveredId}
              onFocus={focus}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onToggle={onToggle}
              onOpenStudy={(nodeId) => void openStudySession(nodeId)}
              onOpenPage={(id) => onOpenPage?.(id)}
              onTodo={(id, checked) => void libraryBlocksRepo.update(id, { checked })}
              onInsert={onInsert}
              onDragStart={setDragId}
              onDragOver={(id, event) => {
                if (!dragId || dragId === id) return
                event.preventDefault()
                setDropId(id)
              }}
              onDrop={onDrop}
              onDragEnd={() => {
                setDragId(null)
                setDropId(null)
              }}
              dragging={dragId === block.id}
              dropTarget={dropId === block.id}
            />
            {block.type === 'toggle' && !block.expanded
              ? null
              : block.type === 'page'
                ? null
                : renderBranch(block.id, depth + 1)}
          </li>
        ))}
      </ul>
    )
  }

  if (!ready || stored === undefined) {
    return (
      <div className="page-editor" data-testid="library-page">
        <p className="page-editor-loading">Opening Library…</p>
      </div>
    )
  }

  return (
    <div className="page-editor" data-testid="library-page">
      {page?.parentPageId && onOpenPage && (
        <button type="button" className="page-editor-back" onClick={() => onOpenPage(page.parentPageId!)}>
          <Icon name="chevron-right" className="page-editor-back-icon" />
          Library
        </button>
      )}
      <input
        className="page-title"
        aria-label="Page title"
        value={title}
        placeholder="Library"
        onChange={(event) => writeTitle(event.currentTarget.value)}
        onFocus={() => setFocusId('title')}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'ArrowDown') {
            event.preventDefault()
            const first = childrenOf(blocks, null)[0]
            if (first) setFocusId(first.id)
          }
        }}
      />

      <div className="page-editor-body">
        {renderBranch(null, 0)}
        <button type="button" className="page-editor-tail" aria-label="Add text block" onClick={activateTail} />
      </div>

      {slash && (
        <SlashCommandMenu
          items={slashItems}
          activeIndex={slash.index}
          onHover={(index) => setSlash((s) => s && { ...s, index })}
          onSelect={(item) => void run(() => convertOrInsert(item))}
          onClose={() => setSlash(null)}
          style={{ position: 'fixed', top: slash.top, left: slash.left, zIndex: 60 }}
        />
      )}

      {studyPickFor && (
        <StudyPicker
          nodes={studyNodes ?? []}
          onPick={(node) =>
            attachStudy(
              studyPickFor,
              node.id,
              [node.title, node.arabicTitle].filter(Boolean).join(' — ') || node.title,
            )
          }
          onClose={() => setStudyPickFor(null)}
        />
      )}
    </div>
  )
}

function StudyPicker({
  nodes,
  onPick,
  onClose,
}: {
  nodes: { id: string; title: string; arabicTitle?: string }[]
  onPick: (node: { id: string; title: string; arabicTitle?: string }) => void
  onClose: () => void
}) {
  return (
    <div className="page-study-pick">
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="slash-menu page-slash-menu" role="listbox" aria-label="Study pages" data-testid="study-picker">
        {nodes.length === 0 ? (
          <p className="text-ink-faint px-3 py-3 text-xs">No study items yet. Import a PDF from the top bar.</p>
        ) : (
          nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              role="option"
              className="slash-item"
              onMouseDown={(event) => {
                event.preventDefault()
                onPick(node)
              }}
            >
              <span className="flex-1 truncate">{node.title || node.arabicTitle}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
