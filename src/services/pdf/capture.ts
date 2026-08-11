import { db } from '@/db/db'
import { newId } from '@/lib/id'
import type { NormalizedRect } from '@/types'
import type { PDFDocumentProxy } from '@/services/pdf/pdfjs'

/**
 * PDF region capture (§D9–§D13).
 *
 * The region is re-rendered from the PDF at a deliberately higher scale rather
 * than cropped out of the on-screen canvas. Cropping the visible canvas would
 * tie screenshot quality to whatever zoom the reader happened to be at — snip
 * an Arabic paragraph at 60% and the tashkīl would be unreadable forever.
 * Re-rendering means the capture is always legible regardless of zoom.
 *
 * The result is a Blob in the `assets` table. Nothing is uploaded anywhere, and
 * the note document stores a 20-byte id rather than a megabyte of base64.
 */

/** Roughly 2× a typical screen rendering — legible when zoomed, still small. */
const CAPTURE_SCALE = 2.4
/** Guard against someone snipping a whole A0 poster at 2.4×. */
const MAX_PIXELS = 4_000_000

export interface CaptureResult {
  assetId: string
  width: number
  height: number
  rect: NormalizedRect
  pageNumber: number
}

/**
 * Renders `rect` (in 0..1 page space) of `pageNumber` to a PNG blob.
 * Pure geometry + pdf.js; no DOM measurement, so it behaves identically
 * whatever the reader is currently looking at.
 */
export async function capturePdfRegion(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  rect: NormalizedRect,
): Promise<CaptureResult | null> {
  const page = await pdf.getPage(pageNumber)
  try {
    const base = page.getViewport({ scale: 1 })

    // Fit the requested scale inside the pixel budget.
    let scale = CAPTURE_SCALE
    const wanted = rect.w * base.width * scale * (rect.h * base.height * scale)
    if (wanted > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / wanted)

    const viewport = page.getViewport({ scale })
    const width = Math.max(1, Math.round(rect.w * viewport.width))
    const height = Math.max(1, Math.round(rect.h * viewport.height))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    // Shift the page so the requested region lands at the canvas origin; the
    // canvas is only as big as the region, so everything else is clipped.
    const offsetX = -rect.x * viewport.width
    const offsetY = -rect.y * viewport.height

    await page.render({
      canvas,
      viewport,
      transform: [1, 0, 0, 1, offsetX, offsetY],
      background: '#ffffff',
      // Rendered with *print* intent, not display intent. pdf.js paces display
      // renders with requestAnimationFrame, which is right for the page you are
      // scrolling but wrong for a capture: it makes the snip wait on the
      // display refresh rate, and it stalls outright if the tab is backgrounded
      // mid-capture. Print intent is pdf.js's own "render for output" path and
      // runs straight through.
      intent: 'print',
    }).promise

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    )
    if (!blob) return null

    const assetId = newId('img')
    await db.assets.add({
      id: assetId,
      blob,
      mime: 'image/png',
      width,
      height,
      createdAt: Date.now(),
    })

    return { assetId, width, height, rect, pageNumber }
  } finally {
    page.cleanup()
  }
}

/** Normalises a drag rectangle (any direction) against the page box. */
export function dragToNormalizedRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  pageBox: DOMRect,
): NormalizedRect | null {
  const left = Math.min(start.x, end.x)
  const top = Math.min(start.y, end.y)
  const right = Math.max(start.x, end.x)
  const bottom = Math.max(start.y, end.y)

  const x = (left - pageBox.left) / pageBox.width
  const y = (top - pageBox.top) / pageBox.height
  const w = (right - left) / pageBox.width
  const h = (bottom - top) / pageBox.height

  // Ignore accidental clicks and clamp to the page.
  if (w < 0.005 || h < 0.005) return null
  const clampedX = Math.max(0, Math.min(1, x))
  const clampedY = Math.max(0, Math.min(1, y))
  return {
    x: clampedX,
    y: clampedY,
    w: Math.min(w, 1 - clampedX),
    h: Math.min(h, 1 - clampedY),
  }
}
