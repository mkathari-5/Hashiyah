import type { NormalizedRect } from '@/types'

/**
 * Coordinate conversion for the PDF annotation workspace.
 *
 * Stored geometry is always unrotated PDF page space: origin at the top-left of
 * the original page box, x/y/w/h as fractions of that box. Screen pixels, CSS
 * zoom and panel width must never be persisted.
 */

export type PageRotation = 0 | 90 | 180 | 270

export interface PageBox {
  left: number
  top: number
  width: number
  height: number
}

export interface PagePoint {
  x: number
  y: number
}

export function normalizeRotation(value: number): PageRotation {
  const n = ((Math.round(value / 90) * 90) % 360 + 360) % 360
  return (n === 90 || n === 180 || n === 270 ? n : 0) as PageRotation
}

/** Map a point in unrotated page space into the currently displayed rotation. */
export function toDisplayPoint(point: PagePoint, rotation: PageRotation): PagePoint {
  switch (rotation) {
    case 90:
      return { x: 1 - point.y, y: point.x }
    case 180:
      return { x: 1 - point.x, y: 1 - point.y }
    case 270:
      return { x: point.y, y: 1 - point.x }
    default:
      return point
  }
}

export function fromDisplayPoint(point: PagePoint, rotation: PageRotation): PagePoint {
  switch (rotation) {
    case 90:
      return { x: point.y, y: 1 - point.x }
    case 180:
      return { x: 1 - point.x, y: 1 - point.y }
    case 270:
      return { x: 1 - point.y, y: point.x }
    default:
      return point
  }
}

export function rotateRect(rect: NormalizedRect, rotation: PageRotation): NormalizedRect {
  if (rotation === 0) return { ...rect }
  const corners = [
    toDisplayPoint({ x: rect.x, y: rect.y }, rotation),
    toDisplayPoint({ x: rect.x + rect.w, y: rect.y }, rotation),
    toDisplayPoint({ x: rect.x, y: rect.y + rect.h }, rotation),
    toDisplayPoint({ x: rect.x + rect.w, y: rect.y + rect.h }, rotation),
  ]
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

export function unrotateRect(rect: NormalizedRect, rotation: PageRotation): NormalizedRect {
  if (rotation === 0) return { ...rect }
  const inverse: PageRotation = rotation === 90 ? 270 : rotation === 270 ? 90 : rotation
  return rotateRect(rect, inverse)
}

export function clientToNormalized(client: PagePoint, page: PageBox, rotation: PageRotation = 0): PagePoint {
  const displayed = {
    x: page.width === 0 ? 0 : (client.x - page.left) / page.width,
    y: page.height === 0 ? 0 : (client.y - page.top) / page.height,
  }
  return fromDisplayPoint(displayed, rotation)
}

export function normalizedToClient(point: PagePoint, page: PageBox, rotation: PageRotation = 0): PagePoint {
  const displayed = toDisplayPoint(point, rotation)
  return {
    x: page.left + displayed.x * page.width,
    y: page.top + displayed.y * page.height,
  }
}

export function clientRectToNormalized(
  start: PagePoint,
  end: PagePoint,
  page: PageBox,
  rotation: PageRotation = 0,
  options: { clamp?: boolean; minSize?: number } = {},
): NormalizedRect | null {
  const a = clientToNormalized(start, page, rotation)
  const b = clientToNormalized(end, page, rotation)
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const w = Math.abs(a.x - b.x)
  const h = Math.abs(a.y - b.y)
  const minSize = options.minSize ?? 0.004
  if (w < minSize && h < minSize) return null
  if (!options.clamp) return { x, y, w: Math.max(w, minSize), h: Math.max(h, minSize) }
  const cx = Math.max(0, Math.min(1, x))
  const cy = Math.max(0, Math.min(1, y))
  return {
    x: cx,
    y: cy,
    w: Math.min(Math.max(w, minSize), 1 - cx),
    h: Math.min(Math.max(h, minSize), 1 - cy),
  }
}

export function markCssBox(
  rect: NormalizedRect,
  pageWidth: number,
  pageHeight: number,
  gutter: number,
  rotation: PageRotation = 0,
): { left: number; top: number; width: number; height: number } {
  const shown = rotateRect(rect, rotation)
  return {
    left: gutter + shown.x * pageWidth,
    top: shown.y * pageHeight,
    width: shown.w * pageWidth,
    height: shown.h * pageHeight,
  }
}

export function isMarginRect(rect: NormalizedRect): boolean {
  return rect.x < 0 || rect.y < 0 || rect.x + rect.w > 1 || rect.y + rect.h > 1
}

export function defaultTextRect(origin: PagePoint, pageCssWidth: number, pageCssHeight: number): NormalizedRect {
  return {
    x: origin.x,
    y: origin.y,
    w: Math.max(0.16, 168 / Math.max(pageCssWidth, 1)),
    h: Math.max(0.035, 34 / Math.max(pageCssHeight, 1)),
  }
}

export function translateRect(rect: NormalizedRect, dx: number, dy: number): NormalizedRect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy }
}

export function underlineRectForLine(line: NormalizedRect, thickness = 0.007): NormalizedRect {
  const h = Math.max(thickness, Math.min(0.012, line.h * 0.12 || thickness))
  return {
    x: line.x,
    y: line.y + Math.max(0, line.h - h * 1.15),
    w: line.w,
    h,
  }
}

export function underlineRectsForSelection(rects: NormalizedRect[]): NormalizedRect[] {
  return rects.map((rect) => (rect.h <= 0.014 ? { ...rect } : underlineRectForLine(rect)))
}

/** Horizontal line locked to the start y so a drag stays straight. */
export function horizontalLineFromDrag(start: PagePoint, end: PagePoint, thickness = 0.008): NormalizedRect {
  const x = Math.min(start.x, end.x)
  const w = Math.max(Math.abs(end.x - start.x), 0.012)
  return {
    x,
    y: start.y - thickness / 2,
    w,
    h: thickness,
  }
}

export function displayPageBox(layer: DOMRect, pageLeft: number, pageWidth: number, pageHeight: number): PageBox {
  return {
    left: layer.left + pageLeft,
    top: layer.top,
    width: pageWidth,
    height: pageHeight,
  }
}

export function rectsScaleLinear(rect: NormalizedRect, pageWidth: number): { left: number; width: number } {
  return { left: rect.x * pageWidth, width: rect.w * pageWidth }
}
