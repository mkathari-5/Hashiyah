import type { NormalizedRect } from '@/types'

/** Place a linked label beside the source, preferring empty margin space. */
export function defaultLabelPosition(rects: NormalizedRect[]): { x: number; y: number } {
  if (!rects.length) return { x: 0.72, y: 0.08 }
  const first = rects[0]!
  const right = first.x + first.w
  if (right <= 0.74) {
    return { x: Math.min(0.98, right + 0.012), y: first.y }
  }
  return { x: Math.max(-0.22, first.x - 0.2), y: first.y }
}
