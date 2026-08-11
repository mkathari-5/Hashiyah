import { describe, expect, it } from 'vitest'
import { dragToNormalizedRect } from './capture'

/**
 * The snip rectangle is the anchor for a captured region, so its geometry has
 * to be right in every drag direction — otherwise "return to this screenshot"
 * points at the wrong part of the page.
 */

const pageBox = { left: 100, top: 50, width: 400, height: 800 } as DOMRect

describe('dragToNormalizedRect', () => {
  it('converts a top-left → bottom-right drag into page space', () => {
    const rect = dragToNormalizedRect({ x: 200, y: 250 }, { x: 300, y: 450 }, pageBox)
    expect(rect).toEqual({ x: 0.25, y: 0.25, w: 0.25, h: 0.25 })
  })

  it('normalises a drag made in the opposite direction', () => {
    const forward = dragToNormalizedRect({ x: 200, y: 250 }, { x: 300, y: 450 }, pageBox)
    const backward = dragToNormalizedRect({ x: 300, y: 450 }, { x: 200, y: 250 }, pageBox)
    expect(backward).toEqual(forward)
  })

  it('handles a bottom-left → top-right drag', () => {
    const rect = dragToNormalizedRect({ x: 200, y: 450 }, { x: 300, y: 250 }, pageBox)
    expect(rect).toEqual({ x: 0.25, y: 0.25, w: 0.25, h: 0.25 })
  })

  it('ignores an accidental click rather than capturing a sliver', () => {
    expect(dragToNormalizedRect({ x: 200, y: 250 }, { x: 201, y: 251 }, pageBox)).toBeNull()
  })

  it('clamps a drag that runs off the page', () => {
    const rect = dragToNormalizedRect({ x: 300, y: 650 }, { x: 900, y: 1200 }, pageBox)!
    expect(rect.x).toBeCloseTo(0.5)
    expect(rect.x + rect.w).toBeLessThanOrEqual(1)
    expect(rect.y + rect.h).toBeLessThanOrEqual(1)
  })

  it('keeps a full-page drag at exactly the page bounds', () => {
    const rect = dragToNormalizedRect({ x: 100, y: 50 }, { x: 500, y: 850 }, pageBox)!
    expect(rect).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })
})
