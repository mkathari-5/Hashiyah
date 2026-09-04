import type { PdfTool } from '@/state/useStudyStore'

/** Pixel movement before a click becomes a drag (text boxes, area, line). */
export const MARK_DRAG_THRESHOLD = 5

/** Pixel movement before a highlight/underline stroke is committed. */
export const MARKUP_DRAG_THRESHOLD = 8

export type MarkupIntent = 'select-text' | 'draw-area' | 'draw-line'

/**
 * One owner per pointer. Highlights and underlines either follow native text
 * selection *or* draw a freehand mark — never both in the same gesture.
 */
export function markupPointerDownIntent(tool: PdfTool, onGlyph: boolean): MarkupIntent | null {
  if (tool === 'highlight') return onGlyph ? 'select-text' : 'draw-area'
  if (tool === 'underline') return onGlyph ? 'select-text' : 'draw-line'
  return null
}

export function markupPointerUpAction(args: {
  intent: MarkupIntent
  hasTextSelection: boolean
  dragDistance: number
}): 'apply-text' | 'commit-draw' | 'none' {
  if (args.intent === 'select-text') return args.hasTextSelection ? 'apply-text' : 'none'
  return args.dragDistance >= MARKUP_DRAG_THRESHOLD ? 'commit-draw' : 'none'
}

/** Existing page marks receive clicks only for tools that act on the marks. */
export function marksReceivePointer(tool: PdfTool): boolean {
  return tool === 'select' || tool === 'text' || tool === 'erase'
}

export function textLayerInteractive(tool: PdfTool): boolean {
  return tool === 'select' || tool === 'highlight' || tool === 'underline'
}

export function pointerDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** True when the event started on a pdf.js / OCR glyph, not the empty page. */
export function isPdfGlyphTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el?.closest) return false
  return Boolean(el.closest('.textLayer span, .ocr-text-layer span'))
}

export function keepMarkSelection(tool: PdfTool): boolean {
  return tool === 'select' || tool === 'text' || tool === 'erase'
}
