import { findAllOccurrences, normalize } from '@/lib/arabic'
import { itemIndexAtOffset } from '@/services/pdf/pageText'
import type { NormalizedRect } from '@/types'

/**
 * The bridge between a browser Selection and the offset space that anchors and
 * the search index live in.
 *
 * The important move: the captured text is `pageText.slice(start, end)` — *not*
 * `selection.toString()`. The browser inserts and drops whitespace at line and
 * element boundaries according to CSS, which would make the stored quotation
 * differ from the indexed text by a space here and there. Slicing the canonical
 * string means the quotation shown in the note is character-for-character the
 * string the resolver will later search for.
 */

const CONTEXT_CHARS = 64

export interface PageTextContext {
  pageNumber: number
  /** Element that defines the 0..1 coordinate space (the page box). */
  pageEl: HTMLElement
  textLayerEl: HTMLElement
  pageText: string
  itemOffsets: number[]
  rotation: number
}

export interface CapturedSelection {
  pageNumber: number
  text: string
  startOffset: number
  endOffset: number
  itemStart: number
  itemEnd: number
  textBefore: string
  textAfter: string
  occurrenceIndex: number
  rects: NormalizedRect[]
  pageWidth: number
  pageHeight: number
  pageRotation: number
}

/** Nearest ancestor (inclusive) carrying `data-i`, i.e. a pdf.js text item span. */
function itemSpan(node: Node | null, root: HTMLElement): HTMLElement | null {
  let el: Node | null = node
  while (el && el !== root) {
    if (el.nodeType === Node.ELEMENT_NODE && (el as HTMLElement).dataset.i !== undefined) {
      return el as HTMLElement
    }
    el = el.parentNode
  }
  return null
}

/** Character offset of (container, offset) counted from the start of `span`. */
function offsetWithinSpan(span: HTMLElement, container: Node, offset: number): number {
  if (container === span) {
    // Offset is a child index; sum the text of preceding children.
    let total = 0
    for (let i = 0; i < offset && i < span.childNodes.length; i++) {
      total += span.childNodes[i].textContent?.length ?? 0
    }
    return total
  }
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
  let total = 0
  let node = walker.nextNode()
  while (node) {
    if (node === container) return total + offset
    total += node.textContent?.length ?? 0
    node = walker.nextNode()
  }
  return total
}

function toNormalizedRects(range: Range, pageEl: HTMLElement): NormalizedRect[] {
  const page = pageEl.getBoundingClientRect()
  if (page.width === 0 || page.height === 0) return []
  const out: NormalizedRect[] = []
  for (const r of Array.from(range.getClientRects())) {
    if (r.width <= 0 || r.height <= 0) continue
    out.push({
      x: (r.left - page.left) / page.width,
      y: (r.top - page.top) / page.height,
      w: r.width / page.width,
      h: r.height / page.height,
    })
  }
  return mergeRects(out)
}

/** pdf.js emits one client rect per text item; merge those sharing a line. */
function mergeRects(rects: NormalizedRect[]): NormalizedRect[] {
  if (rects.length < 2) return rects
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)
  const merged: NormalizedRect[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    const sameLine = last && Math.abs(last.y - r.y) < last.h * 0.5 && Math.abs(last.h - r.h) < last.h * 0.5
    if (sameLine) {
      const left = Math.min(last.x, r.x)
      const right = Math.max(last.x + last.w, r.x + r.w)
      last.x = left
      last.w = right - left
      last.y = Math.min(last.y, r.y)
      last.h = Math.max(last.h, r.h)
    } else {
      merged.push({ ...r })
    }
  }
  return merged
}

/**
 * Which occurrence of this (normalised) text on this page did the user pick?
 * Resolved by proximity in raw offsets, so repeated sentences stay distinct.
 */
function occurrenceIndexFor(pageText: string, selected: string, startOffset: number): number {
  const norm = normalize(pageText)
  const needle = normalize(selected).text
  if (!needle) return 0
  const hits = findAllOccurrences(norm.text, needle)
  if (hits.length <= 1) return 0
  let best = 0
  let bestDistance = Infinity
  hits.forEach((hit, index) => {
    const raw = norm.map[hit] ?? 0
    const distance = Math.abs(raw - startOffset)
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  })
  return best
}

export function captureSelection(
  selection: Selection,
  ctx: PageTextContext,
): CapturedSelection | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!ctx.textLayerEl.contains(range.startContainer) || !ctx.textLayerEl.contains(range.endContainer)) {
    return null
  }

  const startSpan = itemSpan(range.startContainer, ctx.textLayerEl)
  const endSpan = itemSpan(range.endContainer, ctx.textLayerEl)
  if (!startSpan || !endSpan) return null

  const itemStart = Number(startSpan.dataset.i)
  const itemEnd = Number(endSpan.dataset.i)
  if (Number.isNaN(itemStart) || Number.isNaN(itemEnd)) return null

  const rawStart = ctx.itemOffsets[itemStart] + offsetWithinSpan(startSpan, range.startContainer, range.startOffset)
  const rawEnd = ctx.itemOffsets[itemEnd] + offsetWithinSpan(endSpan, range.endContainer, range.endOffset)
  const startOffset = Math.min(rawStart, rawEnd)
  const endOffset = Math.max(rawStart, rawEnd)
  if (endOffset <= startOffset) return null

  const text = ctx.pageText.slice(startOffset, endOffset)
  if (text.trim().length === 0) return null

  const pageRect = ctx.pageEl.getBoundingClientRect()

  return {
    pageNumber: ctx.pageNumber,
    text,
    startOffset,
    endOffset,
    itemStart: Math.min(itemStart, itemEnd),
    itemEnd: Math.max(itemStart, itemEnd),
    textBefore: ctx.pageText.slice(Math.max(0, startOffset - CONTEXT_CHARS), startOffset),
    textAfter: ctx.pageText.slice(endOffset, endOffset + CONTEXT_CHARS),
    occurrenceIndex: occurrenceIndexFor(ctx.pageText, text, startOffset),
    rects: toNormalizedRects(range, ctx.pageEl),
    pageWidth: pageRect.width,
    pageHeight: pageRect.height,
    pageRotation: ctx.rotation,
  }
}

/**
 * Inverse direction: turn resolved character offsets back into rectangles using
 * the *currently rendered* text layer. Preferred over the stored rects because
 * it is always correct for the current zoom, and it is how a highlight created
 * at 100% renders perfectly at 250%.
 */
export function offsetsToRects(
  ctx: Pick<PageTextContext, 'pageEl' | 'textLayerEl' | 'itemOffsets'>,
  startOffset: number,
  endOffset: number,
): NormalizedRect[] {
  const spanFor = (index: number) =>
    ctx.textLayerEl.querySelector<HTMLElement>(`[data-i="${index}"]`)

  const startItem = itemIndexAtOffset(ctx.itemOffsets, startOffset)
  const endItem = itemIndexAtOffset(ctx.itemOffsets, Math.max(startOffset, endOffset - 1))
  const startEl = spanFor(startItem)
  const endEl = spanFor(endItem)
  if (!startEl || !endEl) return []

  const startText = startEl.firstChild
  const endText = endEl.firstChild
  if (!startText || !endText) return []

  const range = document.createRange()
  try {
    const startWithin = Math.max(
      0,
      Math.min(startOffset - ctx.itemOffsets[startItem], startText.textContent?.length ?? 0),
    )
    const endWithin = Math.max(
      0,
      Math.min(endOffset - ctx.itemOffsets[endItem], endText.textContent?.length ?? 0),
    )
    range.setStart(startText, startWithin)
    range.setEnd(endText, endWithin)
  } catch {
    return []
  }
  return toNormalizedRects(range, ctx.pageEl)
}
