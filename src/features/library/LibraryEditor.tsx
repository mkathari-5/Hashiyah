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
  makeTransientBlock,
  mergeVisible,
  outdentPlacement,
  slashQueryFrom,
  splitContent,
  stripSlashQuery,
  TRANSIENT_BLOCK_ID,
  visibleBlockIds,
  type BlockDef,
} from '@/features/library/libraryPageModel'
import { ensureLibraryPageReady } from '@/features/library/migrateLibraryPages'
import { SlashCommandMenu } from '@/features/library/SlashCommandMenu'
import { useLibraryStore } from '@/state/useLibraryStore'
import type { LibraryBlock } from '@/types'

/**
 * Notion-style page editor for Library Home.
 *
 * New lines are siblings. Nesting is Tab / drag / an explicit insert inside a
 * toggle. Expanding a toggle never creates a child.
 */

type SlashState = {
  blockId: string
  query: string
  index: number
  mode: 'convert' | 'insert'
  top: number
  left: number
}

export function LibraryEditor({ pageId }: { pageId: string }) {
  const stored = useLiveQuery(() => libraryBlocksRepo.forPage(pageId), [pageId])
  const page = useLiveQuery(() => libraryPagesRepo.get(pageId), [pageId])
  const studyNodes = useLiveQuery(() => libraryRepo.all(), [])
  const openStudySession = useLibraryStore((s) => s.openStudySession)

  const [ready, setReady] = useState(false)
  const [title, setTitle] = useState('Library')
  const [transient, setTransient] = useState<LibraryBlock | null>(null)
  const [focusId, setFocusId] = useState<string | null>(TRANSIENT_BLOCK_ID)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [studyPickFor, setStudyPickFor] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const caretRef = useRef(0)
  const chain = useRef(Promise.resolve())
  const transientRef = useRef<LibraryBlock | null>(null)
  transientRef.current = transient

  const run = (job: () => Promise<void>) => {
    const next = chain.current.then(job).catch(() => undefined)
    chain.current = next
    return next
  }

  useEffect(() => {
    void ensureLibraryPageReady().then(() => setReady(true))
  }, [])

  useEffect(() => {
    if (page?.title != null) setTitle(page.title)
  }, [page?.title])

  useEffect(() => {
    if (!ready || stored === undefined) return
    if (transientRef.current) return
    const roots = childrenOf(stored, null)
    setTransient(makeTransientBlock(pageId, null, roots.length))
    if (stored.length === 0) setFocusId(TRANSIENT_BLOCK_ID)
  }, [ready, stored, pageId])

  const blocks = useMemo(
    () =>
      mergeVisible(stored ?? [], transient).map((block) =>
        drafts[block.id] != null ? { ...block, content: drafts[block.id]! } : block,
      ),
    [stored, transient, drafts],
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
    })
    setTransient(null)
    setDrafts((current) => {
      const next = { ...current }
      delete next[TRANSIENT_BLOCK_ID]
      return next
    })
    return created
  }

  const ensurePersisted = async (block: LibraryBlock): Promise<LibraryBlock> => {
    if (block.id !== TRANSIENT_BLOCK_ID) return block
    if (!isPersistableBlock(block)) return block
    return persistTransient(block)
  }

  const onChange = (id: string, content: string, caret: number) => {
    caretRef.current = caret
    setDrafts((current) => ({ ...current, [id]: content }))
    const query = slashQueryFrom(content)
    if (query !== null) {
      const el = document.querySelector(`[data-block-id="${id}"]`) as HTMLElement | null
      if (el) placeMenu(id, 'convert', query, el)
    } else {
      setSlash((s) => (s?.blockId === id && s.mode === 'convert' ? null : s))
    }

    void run(async () => {
      const current =
        id === TRANSIENT_BLOCK_ID ? transientRef.current : blockById(mergeVisible(stored ?? [], transientRef.current), id)
      if (!current) return

      if (id === TRANSIENT_BLOCK_ID) {
        const next = { ...current, content }
        if (!isPersistableBlock(next)) {
          setTransient(next)
          return
        }
        const created = await persistTransient(next)
        setDrafts((d) => {
          const { [TRANSIENT_BLOCK_ID]: _omit, ...rest } = d
          return { ...rest, [created.id]: content }
        })
        setFocusId(created.id)
        return
      }

      await libraryBlocksRepo.update(id, { content })
    })
  }

  const convertOrInsert = async (def: BlockDef) => {
    if (!slash) return
    const { blockId, mode } = slash
    setSlash(null)
    const current =
      blockId === TRANSIENT_BLOCK_ID
        ? transientRef.current
        : blockById(mergeVisible(stored ?? [], transientRef.current), blockId)
    if (!current) return

    if (mode === 'insert') {
      const siblings = childrenOf(mergeVisible(stored ?? [], transientRef.current), current.parentBlockId)
      const index = siblings.findIndex((row) => row.id === current.id) + 1
      if (def.id === 'text') {
        const next = makeTransientBlock(pageId, current.parentBlockId, index)
        setTransient(next)
        setFocusId(TRANSIENT_BLOCK_ID)
        return
      }
      const created = await libraryBlocksRepo.create({
        pageId,
        parentBlockId: current.parentBlockId,
        type: def.id,
        content: '',
        order: index,
        expanded: def.id === 'toggle' ? false : undefined,
      })
      if (def.id === 'study') setStudyPickFor(created.id)
      setFocusId(created.id)
      return
    }

    const content = stripSlashQuery(drafts[current.id] ?? current.content)
    if (current.id === TRANSIENT_BLOCK_ID) {
      const next = { ...current, type: def.id, content }
      if (!isPersistableBlock(next) && def.id === 'text') {
        setTransient(next)
        setFocusId(TRANSIENT_BLOCK_ID)
        return
      }
      const created = await persistTransient(next)
      setDrafts((d) => ({ ...d, [created.id]: content }))
      if (def.id === 'study') setStudyPickFor(created.id)
      setFocusId(created.id)
      return
    }

    await libraryBlocksRepo.update(current.id, { type: def.id, content })
    setDrafts((d) => ({ ...d, [current.id]: content }))
    if (def.id === 'study') setStudyPickFor(current.id)
    setFocusId(current.id)
  }

  const enter = async (block: LibraryBlock, caret: number) => {
    const { before, after } = splitContent(block.content, caret)
    if (block.id === TRANSIENT_BLOCK_ID && !before.trim() && !after.trim()) return

    const live = await ensurePersisted({ ...block, content: before })
    if (live.id === TRANSIENT_BLOCK_ID) {
      setTransient({ ...block, content: before })
      return
    }
    if (block.content !== before) await libraryBlocksRepo.update(live.id, { content: before })

    const siblings = childrenOf(mergeVisible(stored ?? [], transientRef.current), live.parentBlockId)
    const index = siblings.findIndex((row) => row.id === live.id) + 1
    if (!after.trim()) {
      const next = makeTransientBlock(pageId, live.parentBlockId, index)
      setTransient(next)
      setFocusId(TRANSIENT_BLOCK_ID)
      return
    }
    const created = await libraryBlocksRepo.create({
      pageId,
      parentBlockId: live.parentBlockId,
      type: 'text',
      content: after,
      order: index,
    })
    setFocusId(created.id)
  }

  const backspaceStart = async (block: LibraryBlock) => {
    const all = mergeVisible(stored ?? [], transientRef.current)
    const visible = visibleBlockIds(all)
    const at = visible.indexOf(block.id)
    const prevId = at > 0 ? visible[at - 1] : null
    const prev = prevId ? blockById(all, prevId) : undefined

    if (block.id === TRANSIENT_BLOCK_ID) {
      if (!block.content) {
        setTransient(null)
        if (prev) setFocusId(prev.id)
      }
      return
    }

    if (!block.content) {
      await libraryBlocksRepo.remove(block.id)
      if (prev) setFocusId(prev.id)
      else {
        setTransient(makeTransientBlock(pageId, null, 0))
        setFocusId(TRANSIENT_BLOCK_ID)
      }
      return
    }

    if (prev && canMergeWith(prev, block)) {
      const joined = `${prev.content}${block.content}`
      if (prev.id === TRANSIENT_BLOCK_ID) {
        setTransient({ ...prev, content: joined })
      } else {
        await libraryBlocksRepo.update(prev.id, { content: joined })
      }
      await libraryBlocksRepo.remove(block.id)
      setFocusId(prev.id)
    }
  }

  const indent = async (block: LibraryBlock) => {
    const live = await ensurePersisted(block)
    if (live.id === TRANSIENT_BLOCK_ID) return
    const all = mergeVisible((await libraryBlocksRepo.forPage(pageId)) ?? [], transientRef.current)
    const placement = indentPlacement(live, all)
    if (!placement) return
    await libraryBlocksRepo.move(live.id, placement.parentBlockId, placement.order)
    const parent = await libraryBlocksRepo.get(placement.parentBlockId)
    if (parent?.type === 'toggle' && !parent.expanded) {
      await libraryBlocksRepo.update(parent.id, { expanded: true })
    }
    setFocusId(live.id)
  }

  const outdent = async (block: LibraryBlock) => {
    const live = await ensurePersisted(block)
    if (live.id === TRANSIENT_BLOCK_ID) return
    const all = mergeVisible(await libraryBlocksRepo.forPage(pageId), transientRef.current)
    const placement = outdentPlacement(live, all)
    if (!placement) return
    await libraryBlocksRepo.move(live.id, placement.parentBlockId, placement.order)
    setFocusId(live.id)
  }

  const onKeyDown = (id: string, event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const block =
      id === TRANSIENT_BLOCK_ID
        ? transientRef.current
        : blockById(mergeVisible(stored ?? [], transientRef.current), id)
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
      if (block.id === TRANSIENT_BLOCK_ID && !block.content.trim() && (stored?.length ?? 0) > 0) {
        setTransient(null)
        const last = stored![stored!.length - 1]
        if (last) setFocusId(last.id)
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
        void run(() => backspaceStart(block))
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
      const block = blockById(mergeVisible(stored ?? [], transientRef.current), id)
      if (!block || block.type !== 'toggle') return
      await libraryBlocksRepo.update(id, { expanded: !block.expanded })
    })
  }

  const onInsert = (id: string, anchor: HTMLElement) => {
    placeMenu(id, 'insert', '', anchor)
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
    if (last?.id === TRANSIENT_BLOCK_ID) {
      setFocusId(TRANSIENT_BLOCK_ID)
      return
    }
    if (last && last.type === 'text' && !last.content.trim()) {
      setFocusId(last.id)
      return
    }
    setTransient(makeTransientBlock(pageId, null, roots.length))
    setFocusId(TRANSIENT_BLOCK_ID)
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
              onFocus={focus}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onToggle={onToggle}
              onOpenStudy={(nodeId) => void openStudySession(nodeId)}
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
            {block.type === 'toggle' && !block.expanded ? null : renderBranch(block.id, depth + 1)}
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

