import { describe, expect, it } from 'vitest'
import { clusterOcrLines, orderOcrWords } from './readingOrder'

describe('OCR reading order', () => {
  it('sorts an Arabic line right-to-left from bounding boxes', () => {
    const ordered = orderOcrWords([
      { text: 'إبراهيم', x: 0.1, y: 0.2, w: 0.2, h: 0.04 },
      { text: 'ملة', x: 0.35, y: 0.2, w: 0.12, h: 0.04 },
      { text: 'الحنيفية', x: 0.52, y: 0.2, w: 0.25, h: 0.04 },
    ])
    expect(ordered.direction).toBe('rtl')
    expect(ordered.lines[0]?.text).toBe('الحنيفية ملة إبراهيم')
    expect(ordered.words.map((w) => w.text)).toEqual(['الحنيفية', 'ملة', 'إبراهيم'])
  })

  it('keeps an English line left-to-right', () => {
    const ordered = orderOcrWords([
      { text: 'The', x: 0.1, y: 0.1, w: 0.1, h: 0.04 },
      { text: 'book', x: 0.22, y: 0.1, w: 0.12, h: 0.04 },
    ])
    expect(ordered.direction).toBe('ltr')
    expect(ordered.text).toBe('The book')
  })

  it('clusters mixed Arabic and English onto separate lines', () => {
    const clustered = clusterOcrLines([
      { text: 'بسم', x: 0.6, y: 0.1, w: 0.15, h: 0.04 },
      { text: 'الله', x: 0.4, y: 0.1, w: 0.15, h: 0.04 },
      { text: 'Chapter', x: 0.1, y: 0.2, w: 0.2, h: 0.04 },
    ])
    expect(clustered).toHaveLength(2)
    const ordered = orderOcrWords(clustered.flat())
    expect(ordered.direction).toBe('mixed')
  })
})
