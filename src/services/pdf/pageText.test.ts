import { describe, expect, it } from 'vitest'
import { buildPageText, itemIndexAtOffset } from './pageText'

describe('buildPageText', () => {
  it('skips marked-content items exactly as pdf.js TextLayer does', () => {
    const result = buildPageText([
      { str: 'الحنيفية ' },
      {}, // beginMarkedContent — no `str`
      { str: 'ملة إبراهيم' },
    ])
    expect(result.text).toBe('الحنيفية ملة إبراهيم')
    expect(result.itemStrings).toHaveLength(2)
    expect(result.itemOffsets).toEqual([0, 9])
  })

  it('inserts a newline for hasEOL and counts it in offsets', () => {
    const result = buildPageText([{ str: 'سطر', hasEOL: true }, { str: 'ثان' }])
    expect(result.text).toBe('سطر\nثان')
    expect(result.itemOffsets).toEqual([0, 4])
  })

  it('is stable for an empty page', () => {
    expect(buildPageText([])).toEqual({ text: '', itemOffsets: [], itemStrings: [] })
  })

  it('keeps empty-string items so span indices stay aligned', () => {
    const result = buildPageText([{ str: 'a' }, { str: '' }, { str: 'b' }])
    expect(result.itemStrings).toHaveLength(3)
    expect(result.itemOffsets).toEqual([0, 1, 1])
  })
})

describe('itemIndexAtOffset', () => {
  const offsets = [0, 10, 25, 40]

  it('finds the item containing an offset', () => {
    expect(itemIndexAtOffset(offsets, 0)).toBe(0)
    expect(itemIndexAtOffset(offsets, 9)).toBe(0)
    expect(itemIndexAtOffset(offsets, 10)).toBe(1)
    expect(itemIndexAtOffset(offsets, 39)).toBe(2)
    expect(itemIndexAtOffset(offsets, 999)).toBe(3)
  })

  it('handles an empty page', () => {
    expect(itemIndexAtOffset([], 5)).toBe(-1)
  })
})
