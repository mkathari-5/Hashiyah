import type { LibraryBlock, LibraryBlockType } from '@/types'

/**
 * Pure helpers for the Library page editor.
 *
 * Nesting, slash filtering and persistence rules live here so the React tree
 * and the tests cannot disagree.
 */

export const TRANSIENT_PREFIX = '__transient__'
/** Root-level trailing draft. Nested drafts use `transientIdFor(parentId)`. */
export const TRANSIENT_BLOCK_ID = TRANSIENT_PREFIX

export const PREVIOUS_LIBRARY_TITLE = 'Previous Library'

/** One rem per nesting level — the only indentation increment. */
export const PAGE_INDENT_REM = 1.5

export interface BlockDef {
  id: LibraryBlockType
  title: string
  icon: string
  keywords: string[]
}

export const LIBRARY_BLOCK_CATALOGUE: BlockDef[] = [
  { id: 'text', title: 'Text', icon: '¶', keywords: ['text', 'paragraph', 'plain', 'body'] },
  { id: 'toggle', title: 'Toggle list', icon: '▸', keywords: ['toggle', 'list', 'collapse', 'fold'] },
  { id: 'heading1', title: 'Heading 1', icon: 'H₁', keywords: ['h1', 'heading 1', 'heading', 'title'] },
  { id: 'heading2', title: 'Heading 2', icon: 'H₂', keywords: ['h2', 'heading 2', 'heading'] },
  { id: 'heading3', title: 'Heading 3', icon: 'H₃', keywords: ['h3', 'heading 3', 'heading'] },
  { id: 'bullet', title: 'Bulleted list', icon: '•', keywords: ['bullet', 'list', 'unordered', 'ul'] },
  { id: 'numbered', title: 'Numbered list', icon: '1.', keywords: ['numbered', 'number', 'list', 'ordered', 'ol'] },
  { id: 'todo', title: 'To-do', icon: '☑', keywords: ['todo', 'to-do', 'to do', 'check', 'task'] },
  { id: 'quote', title: 'Quote', icon: '❝', keywords: ['quote', 'blockquote', 'citation'] },
  { id: 'divider', title: 'Divider', icon: '—', keywords: ['divider', 'line', 'separator', 'hr'] },
  { id: 'study', title: 'Study page', icon: '▣', keywords: ['study', 'page', 'item', 'note'] },
  { id: 'book', title: 'Book / PDF — Upload or attach a PDF book', icon: '▤', keywords: ['book', 'pdf', 'file', 'attachment', 'upload', 'document'] },
  { id: 'page', title: 'Page', icon: '▣', keywords: ['page', 'subpage', 'archive'] },
]

export function transientIdFor(parentBlockId: string | null): string {
  return parentBlockId ? `${TRANSIENT_PREFIX}:${parentBlockId}` : TRANSIENT_PREFIX
}

export function isTransientId(id: string): boolean {
  return id === TRANSIENT_PREFIX || id.startsWith(`${TRANSIENT_PREFIX}:`)
}

export function parentIdFromTransientId(id: string): string | null {
  if (id === TRANSIENT_PREFIX) return null
  if (id.startsWith(`${TRANSIENT_PREFIX}:`)) return id.slice(TRANSIENT_PREFIX.length + 1) || null
  return null
}

export function filterLibraryBlocks(query: string): BlockDef[] {
  const q = query.trim().toLowerCase().replace(/^\//, '')
  if (!q) return LIBRARY_BLOCK_CATALOGUE

  const scored: { block: BlockDef; score: number }[] = []
  for (const block of LIBRARY_BLOCK_CATALOGUE) {
    const haystack = [block.title.toLowerCase(), block.id, ...block.keywords]
    let score = -1
    for (const term of haystack) {
      if (term === q) score = Math.max(score, 4)
      else if (term.startsWith(q)) score = Math.max(score, 3)
      else if (term.includes(q)) score = Math.max(score, 1)
    }
    if (score > 0) scored.push({ block, score })
  }
  return scored.sort((a, b) => b.score - a.score || a.block.title.localeCompare(b.block.title)).map((s) => s.block)
}

export function slashQueryFrom(content: string): string | null {
  const match = content.match(/(?:^|\n)\/([^\n]*)$/)
  return match ? match[1] : null
}

export function stripSlashQuery(content: string): string {
  return content.replace(/(?:^|\n)\/[^\n]*$/, (chunk) => (chunk.startsWith('\n') ? '\n' : '')).replace(/\n$/, '')
}

export function isPersistableBlock(block: Pick<LibraryBlock, 'type' | 'content' | 'libraryNodeId' | 'targetPageId' | 'bookId' | 'documentId'>): boolean {
  if (block.type === 'divider' || block.type === 'study' || block.type === 'page') return true
  if (block.type === 'book') return !!(block.bookId || block.documentId || block.libraryNodeId)
  if (slashQueryFrom(block.content) !== null) return false
  return block.content.trim().length > 0
}

export function displayTitleOf(block: Pick<LibraryBlock, 'content' | 'type'>): string {
  return block.content
}

export function childrenOf(blocks: LibraryBlock[], parentId: string | null): LibraryBlock[] {
  const kids = blocks.filter((block) => block.parentBlockId === parentId)
  const stored = kids
    .filter((block) => !isTransientId(block.id))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const drafts = kids
    .filter((block) => isTransientId(block.id))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const next = [...stored]
  for (const draft of drafts) {
    const at = Number.isFinite(draft.order)
      ? Math.max(0, Math.min(Math.round(draft.order), next.length))
      : next.length
    next.splice(at, 0, draft)
  }
  return next
}

export function blockById(blocks: LibraryBlock[], id: string): LibraryBlock | undefined {
  return blocks.find((block) => block.id === id)
}

/** True when `candidateParentId` is `id` or sits anywhere beneath it. */
export function isDescendantOrSelf(
  blocks: LibraryBlock[],
  id: string,
  candidateParentId: string | null,
): boolean {
  if (!candidateParentId) return false
  if (candidateParentId === id) return true
  const seen = new Set<string>()
  let current: string | null = candidateParentId
  while (current && !seen.has(current)) {
    if (current === id) return true
    seen.add(current)
    current = blockById(blocks, current)?.parentBlockId ?? null
  }
  return false
}

export function previousSibling(block: LibraryBlock, blocks: LibraryBlock[]): LibraryBlock | null {
  const siblings = childrenOf(blocks, block.parentBlockId)
  const index = siblings.findIndex((row) => row.id === block.id)
  if (index <= 0) return null
  return siblings[index - 1] ?? null
}

/**
 * Tab: become the last child of the previous sibling. Never invents a parent.
 */
export function indentPlacement(
  block: LibraryBlock,
  blocks: LibraryBlock[],
): { parentBlockId: string; order: number } | null {
  const prev = previousSibling(block, blocks)
  if (!prev) return null
  if (isDescendantOrSelf(blocks, block.id, prev.id)) return null
  return { parentBlockId: prev.id, order: childrenOf(blocks, prev.id).length }
}

/**
 * Shift+Tab: sit after the current parent, among the parent's siblings.
 */
export function outdentPlacement(
  block: LibraryBlock,
  blocks: LibraryBlock[],
): { parentBlockId: string | null; order: number } | null {
  if (!block.parentBlockId) return null
  const parent = blockById(blocks, block.parentBlockId)
  if (!parent) return null
  const uncles = childrenOf(blocks, parent.parentBlockId)
  const parentIndex = uncles.findIndex((row) => row.id === parent.id)
  return { parentBlockId: parent.parentBlockId, order: parentIndex + 1 }
}

export function numberedIndex(block: LibraryBlock, blocks: LibraryBlock[]): number {
  const siblings = childrenOf(blocks, block.parentBlockId)
  let n = 0
  for (const sibling of siblings) {
    if (sibling.type !== 'numbered') {
      if (sibling.id === block.id) return 1
      n = 0
      continue
    }
    n += 1
    if (sibling.id === block.id) return n
  }
  return 1
}

export function splitContent(content: string, cursor: number): { before: string; after: string } {
  const at = Math.max(0, Math.min(cursor, content.length))
  return { before: content.slice(0, at), after: content.slice(at) }
}

export function makeTransientBlock(
  pageId: string,
  parentBlockId: string | null,
  order: number,
  type: LibraryBlockType = 'text',
  seeded = false,
): LibraryBlock {
  return {
    id: transientIdFor(parentBlockId),
    pageId,
    parentBlockId,
    type,
    content: '',
    order,
    expanded: false,
    createdAt: seeded ? 0 : 1,
    updatedAt: 0,
  }
}

/** Types that Enter continues as another item of the same type. */
export function isContinueType(type: LibraryBlockType): boolean {
  return type === 'toggle' || type === 'bullet' || type === 'numbered' || type === 'todo' || type === 'quote'
}

/** Headings (and everything else) become a text sibling. */
export function enterContinuationType(type: LibraryBlockType): LibraryBlockType {
  return isContinueType(type) ? type : 'text'
}

/** 0-based splice index immediately after `block` among its siblings. */
export function spliceIndexAfter(block: LibraryBlock, blocks: LibraryBlock[]): number {
  const siblings = childrenOf(blocks, block.parentBlockId)
  const index = siblings.findIndex((row) => row.id === block.id)
  return index < 0 ? siblings.length : index + 1
}

export function mergeVisible(blocks: LibraryBlock[], transients: LibraryBlock[]): LibraryBlock[] {
  if (transients.length === 0) return blocks
  const ids = new Set(blocks.map((block) => block.id))
  return [...blocks, ...transients.filter((block) => !ids.has(block.id))]
}

/**
 * Keep live drafts the user actually created. Do not append a trailing root
 * draft merely because the page has blocks. An empty page still gets one
 * ephemeral line, and an empty expanded toggle still gets a nested editor.
 */
export function nextTransients(
  pageId: string,
  stored: LibraryBlock[],
  current: Record<string, LibraryBlock>,
  omitted: ReadonlySet<string> = new Set(),
  focusedId: string | null = null,
): Record<string, LibraryBlock> {
  const storedIds = new Set(stored.map((block) => block.id))
  const next: Record<string, LibraryBlock> = {}

  for (const [id, block] of Object.entries(current)) {
    if (!isTransientId(id)) continue
    if (omitted.has(id)) continue
    if (block.parentBlockId) {
      const parent = stored.find((row) => row.id === block.parentBlockId)
      if (!parent || !storedIds.has(parent.id)) continue
      if (parent.type === 'toggle' && !parent.expanded) continue
      if (parent.type === 'page') continue
    }
    next[id] = block
  }

  const rootId = transientIdFor(null)
  const storedRoots = childrenOf(stored, null)
  if (storedRoots.length === 0) {
    if (!next[rootId] && !omitted.has(rootId)) {
      next[rootId] = makeTransientBlock(pageId, null, 0, 'text', true)
    }
  } else if (
    next[rootId] &&
    !next[rootId].content.trim() &&
    focusedId !== rootId &&
    next[rootId].createdAt === 0
  ) {
    delete next[rootId]
  }

  for (const toggle of stored) {
    if (toggle.type !== 'toggle' || !toggle.expanded) continue
    if (childrenOf(stored, toggle.id).length > 0) continue
    const id = transientIdFor(toggle.id)
    if (omitted.has(id)) continue
    if (!next[id]) next[id] = makeTransientBlock(pageId, toggle.id, 0, 'text', true)
  }

  return next
}

export function reconcileTransients(
  current: Record<string, LibraryBlock>,
  incoming: Record<string, LibraryBlock>,
): Record<string, LibraryBlock> {
  const currentKeys = Object.keys(current).sort().join('|')
  const incomingKeys = Object.keys(incoming).sort().join('|')
  if (currentKeys === incomingKeys) return current
  const out: Record<string, LibraryBlock> = {}
  for (const [id, block] of Object.entries(incoming)) {
    out[id] = current[id] ?? block
  }
  return out
}

/**
 * Depth-first walk of currently visible blocks. Children of a collapsed
 * toggle or of a page link are omitted.
 */
export function visibleBlockIds(blocks: LibraryBlock[], parentId: string | null = null): string[] {
  const out: string[] = []
  for (const block of childrenOf(blocks, parentId)) {
    out.push(block.id)
    if (block.type === 'toggle' && !block.expanded) continue
    if (block.type === 'page' || block.type === 'book') continue
    out.push(...visibleBlockIds(blocks, block.id))
  }
  return out
}

export function isTextLike(type: LibraryBlockType): boolean {
  return type !== 'divider' && type !== 'study' && type !== 'page' && type !== 'book'
}

/** Titles that participate in the study outline rather than free writing. */
export function isStructuralLibraryType(type: LibraryBlockType): boolean {
  return (
    type === 'toggle' ||
    type === 'heading1' ||
    type === 'heading2' ||
    type === 'heading3' ||
    type === 'study' ||
    type === 'book'
  )
}

export function canMergeWith(previous: LibraryBlock, current: LibraryBlock): boolean {
  if (!isTextLike(previous.type) || !isTextLike(current.type)) return false
  return true
}

export function placeholderFor(type: LibraryBlockType, opts?: { focused?: boolean; transient?: boolean }): string {
  const active = opts?.focused || opts?.transient
  if (type === 'toggle') return active ? 'Toggle' : ''
  if (type === 'heading1' || type === 'heading2' || type === 'heading3') return active ? 'Heading' : ''
  if (type === 'quote') return active ? 'Empty quote' : ''
  if (type === 'todo') return active ? 'To-do' : ''
  if (type === 'bullet' || type === 'numbered') return active ? 'List' : ''
  if (type === 'page') return active ? 'Page' : ''
  if (type === 'book') return 'Book / PDF'
  return active ? "Type '/' for commands" : ''
}

export function ariaLabelFor(type: LibraryBlockType): string {
  return LIBRARY_BLOCK_CATALOGUE.find((entry) => entry.id === type)?.title ?? 'Text'
}
