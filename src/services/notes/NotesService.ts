import { z } from 'zod'
import { libraryRepo } from '@/db/repos/libraryTree'
import { noteDocsRepo, notesRepo } from '@/db/repos/notes'
import type { NoteLink, QuoteRef } from '@/types'

/**
 * NotesService — persistence and the derived quote index.
 *
 * The ProseMirror document is the single source of truth for which passages a
 * note quotes. `quoteRefs` is re-derived from it on every save inside the same
 * transaction, which is what makes "which notes mention this passage?" a real
 * indexed query without ever risking the index disagreeing with the note.
 */

const pmNode: z.ZodType<{ type: string }> = z.lazy(() =>
  z.object({
    type: z.string(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(pmNode).optional(),
    marks: z.array(z.object({ type: z.string() }).loose()).optional(),
    text: z.string().optional(),
  }),
)

const pmDoc = z.object({
  type: z.literal('doc'),
  content: z.array(pmNode).optional(),
})

interface RawNode {
  type: string
  attrs?: Record<string, unknown>
  content?: RawNode[]
  text?: string
}

/** Depth-first walk collecting every `sourceQuote` node, in document order. */
export function collectQuoteRefs(doc: unknown, noteId: string): Omit<QuoteRef, 'id'>[] {
  const refs: Omit<QuoteRef, 'id'>[] = []
  const seen = new Set<string>()
  let order = 0

  const visit = (node: RawNode | undefined) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'sourceQuote') {
      const annotationId = node.attrs?.annotationId
      const blockId = node.attrs?.blockId
      if (typeof annotationId === 'string' && typeof blockId === 'string' && !seen.has(blockId)) {
        seen.add(blockId)
        refs.push({ noteId, annotationId, blockId, order: order++ })
      }
    }
    node.content?.forEach(visit)
  }

  visit(doc as RawNode)
  return refs
}

/** First heading, else first non-empty paragraph, capped for the sidebar. */
export function deriveTitle(doc: unknown): string | null {
  const root = doc as RawNode
  if (!root?.content) return null

  const textOf = (node: RawNode): string =>
    node.text ?? (node.content ?? []).map(textOf).join('')

  for (const node of root.content) {
    if (node.type !== 'heading') continue
    const text = textOf(node).trim()
    if (text) return text.slice(0, 80)
  }
  for (const node of root.content) {
    if (node.type !== 'paragraph') continue
    const text = textOf(node).trim()
    if (text) return text.slice(0, 80)
  }
  return null
}

/**
 * Every toggle's open/closed state, keyed by block id (§E30).
 *
 * This is what revision mode records before it flattens a chapter, and what
 * puts the reader's sections back afterwards.
 */
export function collectToggleStates(doc: unknown): Record<string, boolean> {
  const states: Record<string, boolean> = {}
  const visit = (node: RawNode | undefined) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'toggleBlock' && typeof node.attrs?.blockId === 'string') {
      states[node.attrs.blockId] = node.attrs.open !== false
    }
    node.content?.forEach(visit)
  }
  visit(doc as RawNode)
  return states
}

/**
 * A copy of `doc` with each toggle's `open` set from `states`.
 *
 * Pure, and structural rather than positional: toggles are matched by block id,
 * so a document edited during revision still gets exactly the sections it had
 * back. Toggles the snapshot does not mention — ones written since — are left
 * as they are. Nothing but the `open` attribute is touched, so block ids,
 * source quotes and anchors pass through untouched.
 */
export function applyToggleStates(doc: unknown, states: Record<string, boolean>): unknown {
  const visit = (node: RawNode): RawNode => {
    const content = node.content?.map(visit)
    const blockId = node.attrs?.blockId
    const wanted = node.type === 'toggleBlock' && typeof blockId === 'string' ? states[blockId] : undefined

    if (wanted === undefined) return content ? { ...node, content } : node
    return { ...node, attrs: { ...node.attrs, open: wanted }, ...(content ? { content } : {}) }
  }
  if (!doc || typeof doc !== 'object') return doc
  return visit(doc as RawNode)
}

/** Wiki links, derived the same way quote refs are — from the document itself. */
export function collectNoteLinks(doc: unknown, noteId: string): Omit<NoteLink, 'id'>[] {
  const links: Omit<NoteLink, 'id'>[] = []
  const seen = new Set<string>()

  const visit = (node: RawNode | undefined, blockId: string) => {
    if (!node || typeof node !== 'object') return
    const ownBlockId = (node.attrs?.blockId as string | undefined) ?? blockId
    if (node.type === 'wikiLink') {
      const label = String(node.attrs?.label ?? '').trim()
      if (label) {
        const key = `${ownBlockId}:${label}`
        if (!seen.has(key)) {
          seen.add(key)
          links.push({
            sourceNoteId: noteId,
            blockId: ownBlockId,
            targetType: (node.attrs?.targetType as NoteLink['targetType']) ?? 'concept',
            targetId: (node.attrs?.targetId as string | null) ?? null,
            label,
          })
        }
      }
    }
    node.content?.forEach((child) => visit(child, ownBlockId))
  }

  visit(doc as RawNode, 'root')
  return links
}

export interface OutlineEntry {
  blockId: string
  kind: 'heading' | 'toggle'
  /** Heading level 1–3, or nesting depth for a toggle (0 = top level). */
  level: number
  text: string
}

/**
 * The navigable skeleton of a note (§17, §E29).
 *
 * Headings and toggle titles — the things a reader would use to find their way
 * around a chapter. Deliberately *not* the note's full contents: the sidebar is
 * navigation, and re-rendering every benefit, evidence block and quotation
 * there would just be the note twice.
 *
 * Callers filter by `kind` and `level`; the sidebar shows headings plus
 * top-level toggles, which is the shape of a revision chapter.
 */
export function collectOutline(doc: unknown): OutlineEntry[] {
  const out: OutlineEntry[] = []
  const textOf = (node: RawNode): string => node.text ?? (node.content ?? []).map(textOf).join('')

  const visit = (node: RawNode | undefined, toggleDepth: number) => {
    if (!node || typeof node !== 'object') return

    if (node.type === 'heading') {
      const text = textOf(node).trim()
      if (text) {
        out.push({
          blockId: String(node.attrs?.blockId ?? ''),
          kind: 'heading',
          level: Number(node.attrs?.level ?? 1),
          text,
        })
      }
    }

    if (node.type === 'toggleBlock') {
      // The title lives in the first child; the body is deliberately not read.
      const summary = node.content?.find((child) => child.type === 'toggleSummary')
      const text = summary ? textOf(summary).trim() : ''
      if (text) {
        out.push({
          blockId: String(node.attrs?.blockId ?? ''),
          kind: 'toggle',
          level: toggleDepth,
          text,
        })
      }
      node.content?.forEach((child) => visit(child, toggleDepth + 1))
      return
    }

    node.content?.forEach((child) => visit(child, toggleDepth))
  }

  visit(doc as RawNode, 0)
  return out
}

/** What the study sidebar shows: headings and top-level toggles only (§E29). */
export function navigationOutline(doc: unknown): OutlineEntry[] {
  return collectOutline(doc).filter((entry) => entry.kind === 'heading' || entry.level === 0)
}

/** Word count for the status bar. Counts Arabic and Latin runs alike. */
export function countWords(doc: unknown): number {
  const parts: string[] = []
  const visit = (node: RawNode | undefined) => {
    if (!node || typeof node !== 'object') return
    if (typeof node.text === 'string') parts.push(node.text)
    node.content?.forEach(visit)
  }
  visit(doc as RawNode)
  const words = parts.join(' ').trim().match(/\S+/g)
  return words ? words.length : 0
}

export class NoteValidationError extends Error {}

/**
 * Persist a note. The document is validated first: if it is somehow malformed
 * we refuse the write and keep the last known-good version rather than
 * overwriting a good note with a broken one (§63 — data integrity beats polish).
 *
 * Titles: a note that a library node owns takes its identity from that node and
 * is never renamed by what is written inside it. A chapter is `Chapter 3 — باب
 * الخوف من الشرك`; an `H1` reading "Evidence from the Qurʾān" is a section of
 * that chapter, not a new name for it. Ownership is read from the tree —
 * `libraryNodes.noteId` — rather than inferred by comparing title strings,
 * which would break the moment a reader legitimately renamed either one.
 *
 * A standalone note has no such identity, so it keeps deriving one (§17).
 */
export async function saveNote(noteId: string, doc: unknown): Promise<void> {
  const parsed = pmDoc.safeParse(doc)
  if (!parsed.success) {
    throw new NoteValidationError('Refusing to save a malformed note document.')
  }
  await noteDocsRepo.save(noteId, doc, collectQuoteRefs(doc, noteId), collectNoteLinks(doc, noteId))

  const title = deriveTitle(doc)
  if (!title) return
  if (await libraryRepo.owner(noteId)) return

  const note = await notesRepo.get(noteId)
  if (note && note.title !== title) await notesRepo.update(noteId, { title })
}
