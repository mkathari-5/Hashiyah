import { libraryRepo } from '@/db/repos/libraryTree'
import { notesRepo, noteDocsRepo } from '@/db/repos/notes'
import { SEMANTIC_BY_KIND } from '@/features/notes/extensions/SemanticBlock'
import { displayLibraryTitle } from '@/features/library/libraryDelete'
import { normalizeForSearch } from '@/lib/arabic'
import { peekLiveNoteDoc } from '@/services/notes/liveNoteEditor'
import type { LibraryNode } from '@/types'

/**
 * Resolving note sections by stable block id — titles, previews, and the
 * searchable picker list. Never used as the navigation key.
 */

interface RawNode {
  type: string
  attrs?: Record<string, unknown>
  content?: RawNode[]
  text?: string
}

export type NoteTargetKind = 'heading' | 'toggle' | 'semantic' | 'paragraph'

export interface NoteTargetHit {
  noteId: string
  noteTitle: string
  blockId: string
  kind: NoteTargetKind
  title: string
  breadcrumb: string[]
  libraryItemId: string | null
  chapterTitle: string | null
}

function textOf(node: RawNode | undefined): string {
  if (!node) return ''
  if (typeof node.text === 'string') return node.text
  return (node.content ?? []).map(textOf).join('')
}

export function namedToggleJSON(
  title: string,
  blockId: string,
  level = 0,
  bodyBlockId?: string,
): RawNode {
  return {
    type: 'toggleBlock',
    attrs: { blockId, open: true, level },
    content: [
      {
        type: 'toggleSummary',
        content: title ? [{ type: 'text', text: title }] : [],
      },
      {
        type: 'toggleContent',
        content: [{ type: 'paragraph', attrs: { blockId: bodyBlockId ?? `${blockId}_body` } }],
      },
    ],
  }
}

function insertIntoParent(node: RawNode, parentId: string, child: RawNode): boolean {
  if (node.type === 'toggleBlock' && String(node.attrs?.blockId ?? '') === parentId) {
    const content = node.content?.find((c) => c.type === 'toggleContent')
    if (content) {
      const parentLevel = Number(node.attrs?.level ?? 0)
      child.attrs = { ...child.attrs, level: parentLevel + 1 }
      content.content = [...(content.content ?? []), child]
      return true
    }
  }
  for (const c of node.content ?? []) {
    if (insertIntoParent(c, parentId, child)) return true
  }
  return false
}

/** Insert a titled toggle into stored ProseMirror JSON without opening the editor. */
export function insertNamedToggleInDoc(
  doc: unknown,
  options: { title: string; parentBlockId?: string | null; blockId: string; bodyBlockId?: string },
): unknown {
  const next = structuredClone(doc && typeof doc === 'object' ? doc : { type: 'doc', content: [] }) as RawNode
  if (next.type !== 'doc') return doc
  const node = namedToggleJSON(options.title, options.blockId, 0, options.bodyBlockId)
  if (options.parentBlockId) {
    const placed = insertIntoParent(next, options.parentBlockId, node)
    if (placed) return next
  }
  next.content = [...(next.content ?? []), node]
  return next
}

export function findNodeByBlockId(doc: unknown, blockId: string): RawNode | null {
  let found: RawNode | null = null
  const visit = (node: RawNode | undefined) => {
    if (!node || found) return
    if (String(node.attrs?.blockId ?? '') === blockId) {
      found = node
      return
    }
    node.content?.forEach(visit)
  }
  visit(doc as RawNode)
  return found
}

export function blockExists(doc: unknown, blockId: string): boolean {
  return findNodeByBlockId(doc, blockId) !== null
}

export function collectBlockIds(doc: unknown): string[] {
  const ids: string[] = []
  const visit = (node: RawNode | undefined) => {
    if (!node) return
    const id = node.attrs?.blockId
    if (typeof id === 'string' && id) ids.push(id)
    node.content?.forEach(visit)
  }
  visit(doc as RawNode)
  return ids
}

export function findBlockTitle(doc: unknown, blockId: string): string | null {
  const node = findNodeByBlockId(doc, blockId)
  if (!node) return null
  if (node.type === 'heading') {
    const text = textOf(node).trim()
    return text || 'Heading'
  }
  if (node.type === 'toggleBlock') {
    const summary = node.content?.find((child) => child.type === 'toggleSummary')
    const text = summary ? textOf(summary).trim() : ''
    return text || 'Toggle'
  }
  if (node.type === 'semanticBlock') {
    const kind = String(node.attrs?.kind ?? '')
    const meta = SEMANTIC_BY_KIND.get(kind)
    const body = textOf(node).trim()
    if (body) return body.split('\n')[0]!.slice(0, 80)
    return meta?.label ?? 'Note'
  }
  const text = textOf(node).trim()
  return text ? text.split('\n')[0]!.slice(0, 80) : null
}

/** Plain-text preview of a block (and a toggle's body), never HTML. */
export function findBlockPreview(doc: unknown, blockId: string, max = 220): string {
  const node = findNodeByBlockId(doc, blockId)
  if (!node) return ''
  const source =
    node.type === 'toggleBlock'
      ? (node.content?.find((child) => child.type === 'toggleContent') ?? node)
      : node
  const text = textOf(source).replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max).trimEnd()}…`
}

interface WalkHit {
  blockId: string
  kind: NoteTargetKind
  title: string
  ancestors: string[]
}

function collectTargetWalk(doc: unknown): WalkHit[] {
  const out: WalkHit[] = []
  const visit = (node: RawNode | undefined, toggleTitles: string[]) => {
    if (!node) return
    const blockId = String(node.attrs?.blockId ?? '')

    if (node.type === 'heading') {
      const title = textOf(node).trim()
      if (title && blockId) out.push({ blockId, kind: 'heading', title, ancestors: [...toggleTitles] })
    }

    if (node.type === 'toggleBlock') {
      const summary = node.content?.find((child) => child.type === 'toggleSummary')
      const title = summary ? textOf(summary).trim() : ''
      if (title && blockId) out.push({ blockId, kind: 'toggle', title, ancestors: [...toggleTitles] })
      const next = title ? [...toggleTitles, title] : toggleTitles
      node.content?.forEach((child) => visit(child, next))
      return
    }

    if (node.type === 'semanticBlock' && blockId) {
      const title = findBlockTitle(node, blockId) ?? SEMANTIC_BY_KIND.get(String(node.attrs?.kind ?? ''))?.label ?? 'Note'
      out.push({ blockId, kind: 'semantic', title, ancestors: [...toggleTitles] })
    }

    node.content?.forEach((child) => visit(child, toggleTitles))
  }
  visit(doc as RawNode, [])
  return out
}

function ancestorChain(nodes: Map<string, LibraryNode>, id: string | undefined): string[] {
  const titles: string[] = []
  let current = id ?? null
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const node = nodes.get(current)
    if (!node) break
    titles.unshift(displayLibraryTitle(node.title, node.arabicTitle))
    current = node.parentId
  }
  return titles
}

export async function listNoteTargets(options: {
  bookId?: string | null
  currentNoteId?: string | null
  query?: string
}): Promise<NoteTargetHit[]> {
  const query = (options.query ?? '').trim()
  const needle = query ? normalizeForSearch(query) : ''

  const notes = options.bookId
    ? await notesRepo.forBook(options.bookId)
    : await notesRepo.all()

  if (options.currentNoteId && !notes.some((n) => n.id === options.currentNoteId)) {
    const extra = await notesRepo.get(options.currentNoteId)
    if (extra) notes.unshift(extra)
  }

  const libraryNodes = await libraryRepo.all()
  const byId = new Map(libraryNodes.map((n) => [n.id, n]))
  const ownerByNote = new Map<string, LibraryNode>()
  for (const node of libraryNodes) {
    if (node.noteId) ownerByNote.set(node.noteId, node)
  }

  const hits: NoteTargetHit[] = []
  for (const note of notes) {
    const stored = await noteDocsRepo.get(note.id)
    const liveDoc = peekLiveNoteDoc(note.id)
    const doc = liveDoc ?? stored?.doc
    if (!doc) continue
    const owner = ownerByNote.get(note.id) ?? null
    const libraryPath = owner ? ancestorChain(byId, owner.id) : []
    const chapterTitle = owner ? displayLibraryTitle(owner.title, owner.arabicTitle) : null
    const walked = collectTargetWalk(doc)
    for (const entry of walked) {
      if (needle && !normalizeForSearch(entry.title).includes(needle) && !normalizeForSearch(libraryPath.join(' ')).includes(needle)) {
        continue
      }
      hits.push({
        noteId: note.id,
        noteTitle: note.title,
        blockId: entry.blockId,
        kind: entry.kind,
        title: entry.title,
        breadcrumb: [...libraryPath, ...entry.ancestors],
        libraryItemId: owner?.id ?? null,
        chapterTitle,
      })
    }
  }

  hits.sort((a, b) => {
    const aCurrent = a.noteId === options.currentNoteId ? 0 : 1
    const bCurrent = b.noteId === options.currentNoteId ? 0 : 1
    if (aCurrent !== bCurrent) return aCurrent - bCurrent
    const rank = (kind: NoteTargetKind) => (kind === 'heading' || kind === 'toggle' ? 0 : 1)
    if (rank(a.kind) !== rank(b.kind)) return rank(a.kind) - rank(b.kind)
    return a.title.localeCompare(b.title)
  })

  return hits
}
