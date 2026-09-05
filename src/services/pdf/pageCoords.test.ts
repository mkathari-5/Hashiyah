import { describe, expect, it } from 'vitest'
import {
  clientToNormalized,
  defaultTextRect,
  fromDisplayPoint,
  horizontalLineFromDrag,
  markCssBox,
  movedRect,
  normalizedToClient,
  resizedRect,
  resizedRectFromHandle,
  rotateRect,
  textRectFromDrag,
  toDisplayPoint,
  underlineRectForLine,
  underlineRectsForSelection,
  unrotateRect,
} from './pageCoords'
import type { NormalizedRect } from '@/types'

const PAGE = { left: 100, top: 50, width: 400, height: 800 }

describe('pageCoords', () => {
  it('round-trips client and normalised points at rotation 0', () => {
    const point = clientToNormalized({ x: 300, y: 250 }, PAGE)
    expect(point).toEqual({ x: 0.5, y: 0.25 })
    expect(normalizedToClient(point, PAGE)).toEqual({ x: 300, y: 250 })
  })

  it('keeps stored geometry independent of zoom', () => {
    const rect: NormalizedRect = { x: 0.2, y: 0.3, w: 0.4, h: 0.05 }
    const at100 = markCssBox(rect, 100, 200, 0)
    const at200 = markCssBox(rect, 200, 400, 0)
    expect(at200.left).toBe(at100.left * 2)
    expect(at200.top).toBe(at100.top * 2)
    expect(at200.width).toBe(at100.width * 2)
    expect(at200.height).toBe(at100.height * 2)
  })

  it('ignores gutter when comparing page-relative alignment', () => {
    const rect: NormalizedRect = { x: 0.1, y: 0.2, w: 0.3, h: 0.04 }
    const a = markCssBox(rect, 500, 700, 80)
    const b = markCssBox(rect, 500, 700, 160)
    expect(a.left - 80).toBeCloseTo(b.left - 160)
    expect(a.top).toBe(b.top)
  })

  it('rotates a rect 90 degrees around the page box', () => {
    const rect: NormalizedRect = { x: 0, y: 0, w: 0.5, h: 0.25 }
    const shown = rotateRect(rect, 90)
    expect(shown.x).toBeCloseTo(0.75)
    expect(shown.y).toBeCloseTo(0)
    expect(shown.w).toBeCloseTo(0.25)
    expect(shown.h).toBeCloseTo(0.5)
    const back = unrotateRect(shown, 90)
    expect(back.x).toBeCloseTo(rect.x)
    expect(back.y).toBeCloseTo(rect.y)
    expect(back.w).toBeCloseTo(rect.w)
    expect(back.h).toBeCloseTo(rect.h)
  })

  it('maps a rotated page click back into unrotated storage space', () => {
    const displayed = toDisplayPoint({ x: 0.2, y: 0.4 }, 90)
    expect(fromDisplayPoint(displayed, 90).x).toBeCloseTo(0.2)
    expect(fromDisplayPoint(displayed, 90).y).toBeCloseTo(0.4)
  })

  it('creates a default text box from a click origin', () => {
    const rect = defaultTextRect({ x: 0.1, y: 0.2 }, 400, 800)
    expect(rect.x).toBe(0.1)
    expect(rect.y).toBe(0.2)
    expect(rect.w).toBeGreaterThan(0.15)
    expect(rect.h).toBeGreaterThan(0.03)
  })

  it('turns a click without a drag into the default typewriter size', () => {
    const click = textRectFromDrag({ x: 140, y: 90 }, { x: 142, y: 91 }, PAGE, 0, 400, 800)
    expect(click.w).toBeGreaterThan(0.15)
    const dragged = textRectFromDrag({ x: 140, y: 90 }, { x: 300, y: 180 }, PAGE, 0, 400, 800)
    expect(dragged.w).toBeCloseTo(0.4)
    expect(dragged.h).toBeCloseTo(0.1125)
  })

  it('turns each selection line into a baseline underline rather than one tall box', () => {
    const lines = [
      { x: 0.1, y: 0.2, w: 0.4, h: 0.04 },
      { x: 0.1, y: 0.26, w: 0.35, h: 0.04 },
    ]
    const underlines = underlineRectsForSelection(lines)
    expect(underlines).toHaveLength(2)
    expect(underlines[0]!.h).toBeCloseTo(0.0012)
    expect(underlines[0]!.h).toBeLessThan(0.002)
    expect(underlines[1]!.y).toBeGreaterThan(underlines[0]!.y)
    expect(underlineRectForLine(lines[0]!).y).toBeCloseTo(0.2 + 0.04 - 0.0012)
  })

  it('re-thins the previous oversized default without rewriting a custom hairline', () => {
    const legacy = underlineRectForLine({ x: 0.1, y: 0.5, w: 0.4, h: 0.008 })
    expect(legacy.h).toBeCloseTo(0.0012)
    const custom = underlineRectForLine({ x: 0.1, y: 0.5, w: 0.4, h: 0.001 })
    expect(custom.h).toBeCloseTo(0.001)
    expect(custom.y).toBeCloseTo(0.5)
  })

  it('locks a manual underline to the start y so the stroke stays straight', () => {
    const line = horizontalLineFromDrag({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.72 })
    expect(line.y).toBeCloseTo(0.5 - line.h / 2)
    expect(line.w).toBeCloseTo(0.6)
    expect(line.h).toBeCloseTo(0.0012)
  })

  it('resizes from any handle without inverting the box', () => {
    const origin = { x: 0.2, y: 0.3, w: 0.2, h: 0.05 }
    const fromWest = resizedRectFromHandle(origin, { x: 180, y: 290 }, { x: 140, y: 290 }, PAGE, 0, 'w')
    expect(fromWest.x).toBeCloseTo(0.1)
    expect(fromWest.w).toBeCloseTo(0.3)
    expect(fromWest.h).toBeCloseTo(0.05)
    const fromNorth = resizedRectFromHandle(origin, { x: 180, y: 290 }, { x: 180, y: 250 }, PAGE, 0, 'n')
    expect(fromNorth.y).toBeCloseTo(0.25)
    expect(fromNorth.h).toBeCloseTo(0.1)
  })

  it('moves a text box in page space without using the mark CSS size as a divisor', () => {
    const origin = { x: 0.2, y: 0.3, w: 0.2, h: 0.05 }
    const moved = movedRect(origin, { x: 180, y: 290 }, { x: 220, y: 330 }, PAGE)
    expect(moved.x).toBeCloseTo(0.3)
    expect(moved.y).toBeCloseTo(0.35)
    const zoomedPage = { ...PAGE, width: 800, height: 1600 }
    const startZ = clientToNormalized({ x: 180, y: 290 }, zoomedPage)
    const nowZ = clientToNormalized({ x: 260, y: 370 }, zoomedPage)
    expect(nowZ.x - startZ.x).toBeCloseTo(0.1)
  })

  it('resizes from the origin without inverting the box', () => {
    const origin = { x: 0.2, y: 0.3, w: 0.2, h: 0.05 }
    const next = resizedRect(origin, { x: 180, y: 290 }, { x: 220, y: 330 }, PAGE)
    expect(next.x).toBe(0.2)
    expect(next.w).toBeCloseTo(0.3)
    expect(next.h).toBeCloseTo(0.1)
  })
})
