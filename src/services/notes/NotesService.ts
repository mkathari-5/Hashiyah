import { z } from 'zod'
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
  level: number
  text: string
}

/** Headings, for the notes outline navigator (§17). */
export function collectOutline(doc: unknown): OutlineEntry[] {
  const out: OutlineEntry[] = []
  const textOf = (node: RawNode): string => node.text ?? (node.content ?? []).map(textOf).join('')

  const visit = (node: RawNode | undefined) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'heading') {
      const text = textOf(node).trim()
      if (text) {
        out.push({
          blockId: String(node.attrs?.blockId ?? ''),
          level: Number(node.attrs?.level ?? 1),
          text,
        })
      }
    }
    node.content?.forEach(visit)
  }

  visit(doc as RawNode)
  return out
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
 */
export async function saveNote(noteId: string, doc: unknown): Promise<void> {
  const parsed = pmDoc.safeParse(doc)
  if (!parsed.success) {
    throw new NoteValidationError('Refusing to save a malformed note document.')
  }
  await noteDocsRepo.save(noteId, doc, collectQuoteRefs(doc, noteId), collectNoteLinks(doc, noteId))

  const title = deriveTitle(doc)
  if (title) {
    const note = await notesRepo.get(noteId)
    if (note && note.title !== title) await notesRepo.update(noteId, { title })
  }
}
