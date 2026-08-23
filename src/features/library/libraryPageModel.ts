import type { LibraryBlock, LibraryBlockType } from '@/types'

/**
 * Pure helpers for the Library page editor.
 *
 * Nesting, slash filtering and persistence rules live here so the React tree
 * and the tests cannot disagree.
 */

export const TRANSIENT_BLOCK_ID = '__transient__'

export const PREVIOUS_LIBRARY_TITLE = 'Previous Library'

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
  { id: 'study', title: 'Study page', icon: '▣', keywords: ['study', 'page', 'item', 'book', 'note'] },
]

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

export function isPersistableBlock(block: Pick<LibraryBlock, 'type' | 'content' | 'libraryNodeId'>): boolean {
  if (block.type === 'divider' || block.type === 'study') return true
  if (block.type === 'text' && slashQueryFrom(block.content) !== null) return false
  if (block.type !== 'text') return true
  return block.content.trim().length > 0
}

export function displayTitleOf(block: Pick<LibraryBlock, 'content' | 'type'>): string {
  return block.content
}

export function childrenOf(blocks: LibraryBlock[], parentId: string | null): LibraryBlock[] {
  return blocks
    .filter((block) => block.parentBlockId === parentId)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
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

export function makeTransientBlock(pageId: string, parentBlockId: string | null, order: number): LibraryBlock {
  return {
    id: TRANSIENT_BLOCK_ID,
    pageId,
    parentBlockId,
    type: 'text',
    content: '',
    order,
    expanded: false,
    createdAt: 0,
    updatedAt: 0,
  }
}

export function mergeVisible(
  blocks: LibraryBlock[],
  transient: LibraryBlock | null,
): LibraryBlock[] {
  if (!transient) return blocks
  if (blocks.some((block) => block.id === transient.id)) return blocks
  return [...blocks, transient]
}

/**
 * Depth-first walk of currently visible blocks. Children of a collapsed
 * toggle are omitted; children of every other type stay visible.
 */
export function visibleBlockIds(blocks: LibraryBlock[], parentId: string | null = null): string[] {
  const out: string[] = []
  for (const block of childrenOf(blocks, parentId)) {
    out.push(block.id)
    if (block.type === 'toggle' && !block.expanded) continue
    out.push(...visibleBlockIds(blocks, block.id))
  }
  return out
}

export function isTextLike(type: LibraryBlockType): boolean {
  return type !== 'divider' && type !== 'study'
}

export function canMergeWith(previous: LibraryBlock, current: LibraryBlock): boolean {
  if (!isTextLike(previous.type) || !isTextLike(current.type)) return false
  return true
}

export function placeholderFor(type: LibraryBlockType): string {
  if (type === 'toggle') return 'Toggle'
  if (type === 'heading1' || type === 'heading2' || type === 'heading3') return 'Heading'
  if (type === 'quote') return 'Empty quote'
  if (type === 'todo') return 'To-do'
  if (type === 'bullet' || type === 'numbered') return 'List'
  return "Type '/' for commands"
}

export function ariaLabelFor(type: LibraryBlockType): string {
  return LIBRARY_BLOCK_CATALOGUE.find((entry) => entry.id === type)?.title ?? 'Text'
}
