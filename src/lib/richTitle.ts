/**
 * Backward-compatible rich titles for Library items.
 *
 * `title` / `content` stay the searchable plain-text source of truth. Optional
 * `richTitle` / `richContent` stores a single-paragraph Tiptap JSON document
 * with a closed set of inline marks. Existing rows without a rich field keep
 * working: the renderer falls back to the plain string.
 */

export type RichMarkType = 'bold' | 'italic' | 'underline' | 'strike' | 'textStyle' | 'highlight'

export interface RichMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface RichTextNode {
  type: 'text'
  text: string
  marks?: RichMark[]
}

export interface RichParagraph {
  type: 'paragraph'
  content?: RichTextNode[]
}

export interface RichInlineDoc {
  type: 'doc'
  content: RichParagraph[]
}

const ALLOWED_MARKS = new Set<string>(['bold', 'italic', 'underline', 'strike', 'textStyle', 'highlight'])
const ALLOWED_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^var\(--[a-zA-Z0-9-]+\)$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeMark(mark: unknown): RichMark | null {
  if (!isRecord(mark) || typeof mark.type !== 'string') return null
  if (!ALLOWED_MARKS.has(mark.type)) return null
  if (!mark.attrs || !isRecord(mark.attrs)) return { type: mark.type }
  const attrs: Record<string, unknown> = {}
  const color = mark.attrs.color
  if (typeof color === 'string' && ALLOWED_COLOR.test(color)) attrs.color = color
  if (Object.keys(attrs).length === 0) return { type: mark.type }
  return { type: mark.type, attrs }
}

function sanitizeTextNode(node: unknown): RichTextNode | null {
  if (!isRecord(node) || node.type !== 'text' || typeof node.text !== 'string') return null
  const text = node.text.replace(/\n/g, '')
  if (!text) return null
  const marks = Array.isArray(node.marks)
    ? node.marks.map(sanitizeMark).filter((mark): mark is RichMark => !!mark)
    : undefined
  return marks && marks.length ? { type: 'text', text, marks } : { type: 'text', text }
}

/** Accept stored JSON, ignore anything that is not a safe single paragraph. */
export function parseRichDoc(value: unknown): RichInlineDoc | null {
  if (!isRecord(value) || value.type !== 'doc') return null
  const content = Array.isArray(value.content) ? value.content : []
  const paragraph = content.find((node) => isRecord(node) && node.type === 'paragraph')
  if (!paragraph || !isRecord(paragraph)) return null
  const nodes = Array.isArray(paragraph.content)
    ? paragraph.content.map(sanitizeTextNode).filter((node): node is RichTextNode => !!node)
    : []
  return { type: 'doc', content: [{ type: 'paragraph', content: nodes }] }
}

export function richFromPlain(text: string): RichInlineDoc {
  const trimmed = text.replace(/\n/g, '')
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: trimmed ? [{ type: 'text', text: trimmed }] : [],
      },
    ],
  }
}

export function plainFromRich(doc: unknown): string {
  const parsed = parseRichDoc(doc)
  if (!parsed) return typeof doc === 'string' ? doc : ''
  return parsed.content
    .flatMap((block) => block.content ?? [])
    .map((node) => node.text)
    .join('')
}

export function isRichEmpty(doc: unknown): boolean {
  return !plainFromRich(doc).trim()
}

export function hasRichMarks(doc: unknown): boolean {
  const parsed = parseRichDoc(doc)
  if (!parsed) return false
  return parsed.content.some((block) => (block.content ?? []).some((node) => (node.marks?.length ?? 0) > 0))
}

/** Prefer the rich document when it still matches the plain fallback. */
export function displayDoc(plain: string, rich: unknown): RichInlineDoc {
  const parsed = parseRichDoc(rich)
  if (parsed && plainFromRich(parsed) === plain) return parsed
  return richFromPlain(plain)
}

export function splitRichDoc(doc: unknown, caret: number): { before: RichInlineDoc; after: RichInlineDoc } {
  const parsed = parseRichDoc(doc) ?? richFromPlain(plainFromRich(doc))
  const nodes = parsed.content[0]?.content ?? []
  const beforeNodes: RichTextNode[] = []
  const afterNodes: RichTextNode[] = []
  let offset = 0
  const at = Math.max(0, caret)
  for (const node of nodes) {
    const start = offset
    const end = offset + node.text.length
    if (end <= at) {
      beforeNodes.push(node)
    } else if (start >= at) {
      afterNodes.push(node)
    } else {
      const split = at - start
      const left = node.text.slice(0, split)
      const right = node.text.slice(split)
      if (left) beforeNodes.push({ ...node, text: left })
      if (right) afterNodes.push({ ...node, text: right })
    }
    offset = end
  }
  return {
    before: { type: 'doc', content: [{ type: 'paragraph', content: beforeNodes }] },
    after: { type: 'doc', content: [{ type: 'paragraph', content: afterNodes }] },
  }
}

export function concatRichDocs(left: unknown, right: unknown): RichInlineDoc {
  const a = parseRichDoc(left) ?? richFromPlain(plainFromRich(left))
  const b = parseRichDoc(right) ?? richFromPlain(plainFromRich(right))
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [...(a.content[0]?.content ?? []), ...(b.content[0]?.content ?? [])],
      },
    ],
  }
}

export function richEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(parseRichDoc(a) ?? null) === JSON.stringify(parseRichDoc(b) ?? null)
}
