import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { libraryBlocksRepo, libraryPagesRepo } from '@/db/repos/libraryPages'
import { libraryRepo } from '@/db/repos/libraryTree'
import { LibraryBlockRow } from '@/features/library/LibraryBlockRow'
import { BookAttachPicker, type BookAttachChoice } from '@/features/library/BookAttachPicker'
import {
  deleteLibraryBlock,
  inspectBlockDeletion,
  restoreBlockDeletion,
  type DeleteImpact,
} from '@/features/library/libraryDelete'
import {
  blockById,
  canMergeWith,
  childrenOf,
  enterContinuationType,
  filterLibraryBlocks,
  indentPlacement,
  isContinueType,
  isPersistableBlock,
  isStructuralLibraryType,
  isTransientId,
  makeTransientBlock,
  mergeVisible,
  nextTransients,
  spliceIndexAfter,
  outdentPlacement,
  parentIdFromTransientId,
  reconcileTransients,
  slashQueryFrom,
  stripSlashQuery,
  TRANSIENT_BLOCK_ID,
  transientIdFor,
  visibleBlockIds,
  type BlockDef,
} from '@/features/library/libraryPageModel'
import { ensureLibraryPageReady } from '@/features/library/migrateLibraryPages'
import { SlashCommandMenu } from '@/features/library/SlashCommandMenu'
import {
  attachPdfToHost,
  attachUploadedPdf,
  blockOpensStudyWorkspace,
  detachPdfFromBlock,
  replacePdfForBlock,
} from '@/services/library/bookAttachment'
import { openStudyWorkspace } from '@/services/library/openStudyWorkspace'
import { ConfirmDialog } from '@/features/shell/ConfirmDialog'
import { ContextMenu } from '@/features/shell/ContextMenu'
import { Icon } from '@/features/shell/Icon'
import { concatRichDocs, plainFromRich, richFromPlain, splitRichDoc, type RichInlineDoc } from '@/lib/richTitle'
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

  const [ready, setReady] = useState(false)
  const [title, setTitle] = useState('Library')
  const [transients, setTransients] = useState<Record<string, LibraryBlock>>({})
  const [focusId, setFocusId] = useState<string | null>(null)
  const [focusCaret, setFocusCaret] = useState<'start' | 'end'>('end')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [studyPickFor, setStudyPickFor] = useState<string | null>(null)
  const [bookPick, setBookPick] = useState<{
    hostBlockId: string | null
    replaceBlockId: string | null
    createHostToggle: boolean
  } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [richDrafts, setRichDrafts] = useState<Record<string, RichInlineDoc | null>>({})
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [confirm, setConfirm] = useState<DeleteImpact | null>(null)
  const [undo, setUndo] = useState<{ label: string; restore: () => Promise<void> } | null>(null)
  const caretRef = useRef(0)
  const chain = useRef(Promise.resolve())
  const transientsRef = useRef<Record<string, LibraryBlock>>({})
  const storedRef = useRef<LibraryBlock[] | undefined>(undefined)
  const slashRef = useRef<SlashState | null>(null)
  const omittedTransients = useRef(new Set<string>())
  const focusIdRef = useRef<string | null>(null)
  transientsRef.current = transients
  storedRef.current = stored
  slashRef.current = slash
  focusIdRef.current = focusId

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
    setRichDrafts({})
    setFocusId(null)
    setSlash(null)
  }, [pageId])

  useEffect(() => {
    if (page?.title != null) setTitle(page.title)
  }, [page?.title])

  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), 8000)
    return () => window.clearTimeout(timer)
  }, [undo])

  useEffect(() => {
    if (!ready || stored === undefined) return
    setTransients((current) => {
      const incoming = nextTransients(pageId, stored, current, omittedTransients.current, focusId)
      for (const id of [...omittedTransients.current]) {
        const parentId = parentIdFromTransientId(id)
        if (id === TRANSIENT_BLOCK_ID || (parentId && childrenOf(stored, parentId).length > 0)) {
          omittedTransients.current.delete(id)
        }
      }
      return reconcileTransients(current, incoming)
    })
  }, [ready, stored, pageId, focusId])

  const blocks = useMemo(
    () =>
      mergeVisible(stored ?? [], Object.values(transients)).map((block) => {
        const content = drafts[block.id] != null ? drafts[block.id]! : block.content
        const richContent = Object.hasOwn(richDrafts, block.id) ? richDrafts[block.id] : block.richContent
        return { ...block, content, richContent }
      }),
    [stored, transients, drafts, richDrafts],
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

  const focus = (id: string, caret: 'start' | 'end' = 'end') => {
    setFocusCaret(caret)
    setFocusId(id)
  }

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
    transientsRef.current = { ...transientsRef.current, [block.id]: block }
    setTransients((current) => ({ ...current, [block.id]: block }))
  }

  const dropTransient = (id: string) => {
    omittedTransients.current.add(id)
    const { [id]: _omit, ...rest } = transientsRef.current
    transientsRef.current = rest
    setTransients((current) => {
      if (!current[id]) return current
      const next = { ...current }
      delete next[id]
      return next
    })
    setDrafts((current) => {
      if (current[id] == null) return current
      const next = { ...current }
      delete next[id]
      return next
    })
    setRichDrafts((current) => {
      if (!Object.hasOwn(current, id)) return current
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
      richContent: block.richContent ?? null,
      order: block.order,
      expanded: block.expanded,
      checked: block.checked,
      libraryNodeId: block.libraryNodeId,
      targetPageId: block.targetPageId,
      bookId: block.bookId,
      documentId: block.documentId,
      noteBlockId: block.noteBlockId,
    })
    dropTransient(block.id)
    return created
  }

  const ensurePersisted = async (block: LibraryBlock): Promise<LibraryBlock> => {
    if (!isTransientId(block.id)) return block
    if (!isPersistableBlock(block)) return block
    return persistTransient(block)
  }

  const onChange = (id: string, content: string, caret: number, rich: RichInlineDoc | null) => {
    caretRef.current = caret
    setDrafts((current) => ({ ...current, [id]: content }))
    setRichDrafts((current) => ({ ...current, [id]: rich }))
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
        const next = { ...current, content, richContent: rich }
        if (!isPersistableBlock(next)) {
          putTransient(next)
          return
        }
        const created = await persistTransient(next)
        setDrafts((d) => {
          const { [id]: _omit, ...rest } = d
          return { ...rest, [created.id]: content }
        })
        setRichDrafts((d) => {
          const { [id]: _omit, ...rest } = d
          return { ...rest, [created.id]: rich }
        })
        setFocusId(created.id)
        return
      }

      await libraryBlocksRepo.update(id, { content, richContent: rich })
      if (current.libraryNodeId) {
        await libraryRepo.update(current.libraryNodeId, { title: content.trim() || current.content, richTitle: rich })
      }
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
      if (!isPersistableBlock(next)) {
        putTransient(next)
        setDrafts((d) => ({ ...d, [current.id]: content }))
        if (def.id === 'study') setStudyPickFor(current.id)
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

    if (def.id === 'book') {
      const structural = isStructuralLibraryType(current.type) && current.type !== 'book' && current.type !== 'page'
      if (structural) {
        const content = stripSlashQuery(drafts[current.id] ?? current.content)
        const host = await ensurePersisted({ ...current, content })
        if (!isTransientId(host.id) && content !== current.content) {
          await libraryBlocksRepo.update(host.id, { content })
        }
        setBookPick({
          hostBlockId: host.id,
          replaceBlockId: null,
          createHostToggle: false,
        })
        return
      }
      const leftover = stripSlashQuery(drafts[current.id] ?? current.content).trim()
      setBookPick({
        hostBlockId: current.parentBlockId,
        replaceBlockId: leftover ? null : current.id,
        createHostToggle: !current.parentBlockId,
      })
      return
    }

    const emptyDraft = isTransientId(current.id) && !current.content.trim()
    if (mode === 'insert' && !emptyDraft) {
      const order = spliceIndexAfter(current, live())
      if (def.id !== 'divider' && def.id !== 'study' && def.id !== 'page') {
        const next = makeTransientBlock(pageId, current.parentBlockId, order, def.id)
        putTransient(next)
        setFocusCaret('start')
        setFocusId(next.id)
        return
      }
      const created = await libraryBlocksRepo.create({
        pageId,
        parentBlockId: current.parentBlockId,
        type: def.id,
        content: '',
        order,
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

  const exitListToText = async (block: LibraryBlock) => {
    if (isTransientId(block.id)) {
      putTransient({ ...block, type: 'text', content: '' })
      setFocusCaret('start')
      setFocusId(block.id)
      return
    }
    const kids = childrenOf(live(), block.id)
    if (kids.length > 0) {
      await libraryBlocksRepo.update(block.id, { type: 'text' })
      setDrafts((d) => ({ ...d, [block.id]: block.content }))
      setFocusId(block.id)
      return
    }
    const parent = block.parentBlockId
    const at = childrenOf(live(), parent).findIndex((row) => row.id === block.id)
    await libraryBlocksRepo.remove(block.id)
    const next = makeTransientBlock(pageId, parent, at < 0 ? 0 : at, 'text')
    putTransient(next)
    setFocusCaret('start')
    setFocusId(next.id)
  }

  const enter = async (block: LibraryBlock, caret: number) => {
    const split = splitRichDoc(block.richContent ?? richFromPlain(block.content), caret)
    const before = plainFromRich(split.before)
    const after = plainFromRich(split.after)
    const continueType = enterContinuationType(block.type)
    const snapshot = live()
    const kids = childrenOf(snapshot, block.id)
    const insertAt = spliceIndexAfter(block, snapshot)
    const currentIndex = childrenOf(snapshot, block.parentBlockId).findIndex((row) => row.id === block.id)

    if (!before.trim() && !after.trim() && isContinueType(block.type) && kids.length === 0) {
      await exitListToText(block)
      return
    }

    if (isTransientId(block.id) && !before.trim() && !after.trim()) return

    if (!before.trim() && after.trim()) {
      const liveBlock = isTransientId(block.id)
        ? await ensurePersisted({ ...block, content: after, richContent: split.after })
        : block
      if (isTransientId(liveBlock.id)) {
        putTransient({ ...block, content: after, richContent: split.after })
        return
      }
      const at = currentIndex < 0 ? 0 : currentIndex
      const next = makeTransientBlock(pageId, liveBlock.parentBlockId, at, continueType)
      putTransient(next)
      await libraryBlocksRepo.move(liveBlock.id, liveBlock.parentBlockId, at + 1)
      setFocusCaret('start')
      setFocusId(next.id)
      return
    }

    const liveBlock = await ensurePersisted({ ...block, content: before, richContent: split.before })
    if (isTransientId(liveBlock.id)) {
      putTransient({ ...block, content: before, richContent: split.before })
      return
    }
    if (block.content !== before) {
      await libraryBlocksRepo.update(liveBlock.id, { content: before, richContent: split.before })
      setDrafts((d) => ({ ...d, [liveBlock.id]: before }))
      setRichDrafts((d) => ({ ...d, [liveBlock.id]: split.before }))
    }

    if (!after.trim()) {
      const next = makeTransientBlock(pageId, liveBlock.parentBlockId, insertAt, continueType)
      setFocusCaret('start')
      setFocusId(next.id)
      putTransient(next)
      return
    }
    const created = await libraryBlocksRepo.create({
      pageId,
      parentBlockId: liveBlock.parentBlockId,
      type: continueType,
      content: after,
      richContent: split.after,
      order: insertAt,
      expanded: continueType === 'toggle' ? false : undefined,
    })
    setDrafts((d) => ({ ...d, [created.id]: after }))
    setRichDrafts((d) => ({ ...d, [created.id]: split.after }))
    setFocusCaret('start')
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
      else setFocusId(null)
      return
    }

    if (prev && canMergeWith(prev, block)) {
      const joinedRich = concatRichDocs(prev.richContent ?? richFromPlain(prev.content), block.richContent ?? richFromPlain(block.content))
      const joined = plainFromRich(joinedRich)
      if (isTransientId(prev.id)) {
        putTransient({ ...prev, content: joined, richContent: joinedRich })
      } else {
        await libraryBlocksRepo.update(prev.id, { content: joined, richContent: joinedRich })
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

  const onKeyDown = (id: string, event: KeyboardEvent, caret: number, _empty: boolean, collapsed: boolean, plain?: string, rich?: RichInlineDoc | null): boolean => {
    const found = blockById(blocks, id) ?? transientsRef.current[id]
    if (!found) return false
    const block = {
      ...found,
      content: plain ?? found.content,
      richContent: rich ?? found.richContent,
    }

    if (slash && slash.blockId === id) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSlash((s) => s && { ...s, index: slashItems.length ? (s.index + 1) % slashItems.length : 0 })
        return true
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSlash((s) =>
          s && { ...s, index: slashItems.length ? (s.index - 1 + slashItems.length) % slashItems.length : 0 },
        )
        return true
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const item = slashItems[slash.index]
        if (item) void run(() => convertOrInsert(item))
        return true
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setSlash(null)
        return true
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        return true
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
      return true
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      void run(() => (event.shiftKey ? outdent(block) : indent(block)))
      return true
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void run(() => enter(block, caret))
      return true
    }

    if (event.key === 'Backspace' && caret === 0 && collapsed) {
      event.preventDefault()
      void run(() => backspaceStart(block, blocks))
      return true
    }

    if (event.key === 'ArrowUp' && caret === 0) {
      event.preventDefault()
      const visible = visibleBlockIds(blocks)
      const at = visible.indexOf(block.id)
      if (at > 0) setFocusId(visible[at - 1]!)
      else setFocusId('title')
      return true
    }

    if (event.key === 'ArrowDown' && caret === block.content.length) {
      event.preventDefault()
      const visible = visibleBlockIds(blocks)
      const at = visible.indexOf(block.id)
      if (at >= 0 && at < visible.length - 1) setFocusId(visible[at + 1]!)
      return true
    }

    return false
  }

  const onToggle = (id: string) => {
    void run(async () => {
      const block = blockById(live(), id)
      if (!block || block.type !== 'toggle') return
      const expanding = !block.expanded
      await libraryBlocksRepo.update(id, { expanded: expanding })
      if (expanding) {
        const kids = childrenOf(await libraryBlocksRepo.forPage(pageId), id)
        if (kids.length === 0) {
          setFocusCaret('start')
          setFocusId(transientIdFor(id))
        }
      }
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

  const onBlurEmpty = (id: string) => {
    window.setTimeout(() => {
      if (slashRef.current?.blockId === id) return
      if (focusIdRef.current === id) return
      const active = document.activeElement as HTMLElement | null
      if (active?.closest('.slash-menu, .page-editor-tail, .page-block-plus, .page-block-handle, .title-format-bar, .node-menu, .confirm-layer')) return
      const safe = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/:/g, '\\:')
      if (active?.closest(`[data-block-id="${safe}"]`)) return
      const block = transientsRef.current[id]
      if (!block || block.content.trim()) return
      const storedNow = storedRef.current ?? []
      if (!block.parentBlockId && childrenOf(storedNow, null).length === 0) return
      if (block.parentBlockId) {
        const parent = storedNow.find((row) => row.id === block.parentBlockId)
        const kids = childrenOf(storedNow, block.parentBlockId)
        if (parent?.type === 'toggle' && parent.expanded && kids.length === 0) return
      }
      dropTransient(id)
      setFocusId((current) => (current === id ? null : current))
    }, 0)
  }

  const activateTail = () => {
    const roots = childrenOf(blocks, null)
    const last = roots[roots.length - 1]
    const rootDraft = transientIdFor(null)
    if (last?.id === rootDraft) {
      if (!last.content.trim() && last.type !== 'text') {
        putTransient({ ...last, type: 'text' })
      }
      setFocusCaret('start')
      setFocusId(rootDraft)
      return
    }
    if (last && last.type === 'text' && !last.content.trim()) {
      setFocusCaret('start')
      setFocusId(last.id)
      return
    }
    const next = makeTransientBlock(pageId, null, last ? spliceIndexAfter(last, blocks) : 0)
    putTransient(next)
    setFocusCaret('start')
    setFocusId(next.id)
  }

  const attachStudy = (blockId: string, nodeId: string, label: string) => {
    void run(async () => {
      await libraryBlocksRepo.update(blockId, { libraryNodeId: nodeId, content: label, type: 'study' })
      setStudyPickFor(null)
    })
  }

  const completeBookAttach = (choice: BookAttachChoice) => {
    const pick = bookPick
    setBookPick(null)
    if (!pick) return
    void run(async () => {
      let hostId = pick.hostBlockId
      if (hostId && isTransientId(hostId)) {
        const host = transientsRef.current[hostId] ?? blockById(live(), hostId)
        if (!host) return
        const created = await persistTransient({
          ...host,
          content: host.content.trim() || 'Untitled',
        })
        hostId = created.id
      }
      if (choice.kind === 'upload') {
        await attachUploadedPdf({
          file: choice.file,
          hostBlockId: hostId,
          pageId,
          replaceBlockId: pick.replaceBlockId,
          createHostToggle: pick.createHostToggle,
        })
      } else {
        await attachPdfToHost({
          bookId: choice.bookId,
          documentId: choice.documentId,
          hostBlockId: hostId,
          pageId,
          replaceBlockId: pick.replaceBlockId,
          createHostToggle: pick.createHostToggle,
        })
      }
      if (pick.replaceBlockId && isTransientId(pick.replaceBlockId)) dropTransient(pick.replaceBlockId)
    })
  }

  const openFromBlock = (id: string) => {
    const block = blockById(blocks, id)
    void openStudyWorkspace({
      libraryBlockId: id,
      noteBlockId: block?.noteBlockId,
      forceThreePane: true,
    })
  }

  const requestDeleteBlock = (id: string) => {
    void inspectBlockDeletion(id).then((impact) => {
      if (!impact) return
      if (!impact.needsConfirm) {
        void run(async () => {
          const snapshot = await deleteLibraryBlock(id)
          if (!snapshot) return
          setFocusId(snapshot.selectAfter)
          setUndo({
            label: `Deleted “${impact.title}”`,
            restore: async () => {
              await restoreBlockDeletion(snapshot)
              setFocusId(id)
              setUndo(null)
            },
          })
        })
        return
      }
      setConfirm(impact)
    })
  }

  const renderBranch = (parentId: string | null, depth: number): React.ReactNode => {
    const kids = childrenOf(blocks, parentId)
    if (kids.length === 0) return null
    return (
      <ul
        className="page-block-list"
        data-depth={depth}
        style={{ ['--branch-depth']: depth } as CSSProperties}
      >
        {kids.map((block) => (
          <li key={block.id}>
            <LibraryBlockRow
              block={block}
              blocks={blocks}
              depth={depth}
              focused={focusId === block.id}
              focusCaret={focusId === block.id ? focusCaret : 'end'}
              gutterOn={hoveredId === block.id || (focusId === block.id && hoveredId === null)}
              opensWorkspace={blockOpensStudyWorkspace(block, blocks)}
              onHover={setHoveredId}
              onFocus={focus}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onBlurEmpty={onBlurEmpty}
              onToggle={onToggle}
              onOpenStudy={(nodeId) => void openStudyWorkspace({ libraryItemId: nodeId, forceThreePane: true })}
              onOpenPage={(id) => onOpenPage?.(id)}
              onOpenWorkspace={openFromBlock}
              onTodo={(id, checked) => void libraryBlocksRepo.update(id, { checked })}
              onInsert={onInsert}
              onContextMenu={(id, event) => {
                if (isTransientId(id)) return
                setMenu({ id, x: event.clientX, y: event.clientY })
              }}
              onAttachBook={(id) =>
                setBookPick({
                  hostBlockId: block.parentBlockId,
                  replaceBlockId: id,
                  createHostToggle: !block.parentBlockId,
                })
              }
              onRenameBook={(id, title) => void libraryBlocksRepo.update(id, { content: title })}
              onReplaceBook={(id, file) => void run(() => replacePdfForBlock(id, file).then(() => undefined))}
              onDetachBook={(id) => void run(() => detachPdfFromBlock(id))}
              onDeleteBook={requestDeleteBlock}
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
              : block.type === 'page' || block.type === 'book'
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
        <button
          type="button"
          className="page-editor-tail"
          data-testid="page-editor-tail"
          aria-label="Add text block"
          onClick={activateTail}
        />
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

      {bookPick && (
        <BookAttachPicker
          onChoose={completeBookAttach}
          onClose={() => setBookPick(null)}
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

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="Library row"
          onClose={() => setMenu(null)}
          items={[
            ...(blockOpensStudyWorkspace(blockById(blocks, menu.id) ?? ({ type: 'text' } as LibraryBlock), blocks)
              ? [
                  {
                    id: 'open',
                    label: 'Open in study workspace',
                    onSelect: () => openFromBlock(menu.id),
                  },
                  {
                    id: 'rename',
                    label: 'Rename',
                    onSelect: () => focus(menu.id),
                  },
                ]
              : []),
            {
              id: 'delete',
              label: 'Delete',
              danger: true,
              onSelect: () => requestDeleteBlock(menu.id),
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
            void run(async () => {
              const snapshot = await deleteLibraryBlock(impact.id)
              if (!snapshot) return
              setFocusId(snapshot.selectAfter)
              setUndo({
                label: `Deleted “${impact.title}”`,
                restore: async () => {
                  await restoreBlockDeletion(snapshot)
                  setFocusId(impact.id)
                  setUndo(null)
                },
              })
            })
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
