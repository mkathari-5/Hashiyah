import { describe, expect, it } from 'vitest'
import { normalizeForSearch } from '@/lib/arabic'
import { ANCHOR_VERSION, type AnnotationAnchor, type PageRecord } from '@/types'
import { resolveAnchor } from './AnchorResolver'

const PHRASE = 'الحنيفية ملة إبراهيم'

function page(pageNumber: number, text: string): PageRecord {
  return {
    id: `doc:${pageNumber}`,
    documentId: 'doc',
    pageNumber,
    text,
    normalizedText: normalizeForSearch(text),
    itemOffsets: [0],
    width: 595,
    height: 842,
    rotation: 0,
    hasTextLayer: true,
    textSource: 'embedded',
    indexedAt: 0,
  }
}

function anchorFor(text: string, source: PageRecord, occurrence = 0, pageNumber = source.pageNumber) {
  const start = source.text.indexOf(text)
  const end = start + text.length
  const anchor: AnnotationAnchor = {
    id: 'anc',
    annotationId: 'ann',
    documentId: 'doc',
    pageNumber,
    startOffset: start,
    endOffset: end,
    itemStart: 0,
    itemEnd: 0,
    occurrenceIndex: occurrence,
    textBefore: source.text.slice(Math.max(0, start - 64), start),
    textAfter: source.text.slice(end, end + 64),
    rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.03 }],
    pageWidth: 595,
    pageHeight: 842,
    pageRotation: 0,
    anchorVersion: ANCHOR_VERSION,
  }
  return anchor
}

describe('resolveAnchor', () => {
  it('1 — resolves exactly when nothing has changed', () => {
    const p = page(4, `وأصل دين إبراهيم: ${PHRASE} وهو التوحيد.`)
    const res = resolveAnchor(anchorFor(PHRASE, p), PHRASE, [p])
    expect(res.strategy).toBe('exact')
    expect(res.confidence).toBe(1)
    expect(p.text.slice(res.startOffset, res.endOffset)).toBe(PHRASE)
  })

  it('2 — recovers via surrounding context when offsets drift', () => {
    const p = page(4, `وأصل دين إبراهيم: ${PHRASE} وهو التوحيد.`)
    const anchor = { ...anchorFor(PHRASE, p), startOffset: 0, endOffset: 5 }
    // Add a second, identical occurrence so `unique` cannot rescue it and the
    // context branch is genuinely what does the work.
    const shifted = page(4, `${PHRASE} في أول الصفحة. وأصل دين إبراهيم: ${PHRASE} وهو التوحيد.`)
    const res = resolveAnchor(anchor, PHRASE, [shifted])
    expect(res.strategy).toBe('context')
    expect(shifted.text.slice(res.startOffset, res.endOffset)).toBe(PHRASE)
    // …and it picked the *second* occurrence, the one the context describes.
    expect(res.startOffset).toBeGreaterThan(PHRASE.length)
  })

  it('3 — distinguishes identical sentences by recorded occurrence', () => {
    const text = `${PHRASE} ثم كرر المصنف: ${PHRASE} ثم ثالثة: ${PHRASE}`
    const p = page(4, text)
    const third = text.lastIndexOf(PHRASE)
    // Strip the context signals so occurrence index is the deciding factor.
    const anchor: AnnotationAnchor = {
      ...anchorFor(PHRASE, p, 2),
      startOffset: 0,
      endOffset: 3,
      textBefore: '',
      textAfter: '',
    }
    const res = resolveAnchor(anchor, PHRASE, [p])
    expect(res.strategy).toBe('occurrence')
    expect(res.startOffset).toBe(third)
  })

  it('matches across diacritics: a bare anchor finds vocalised page text', () => {
    const vocalised = 'ٱلْحَنِيفِيَّةُ مِلَّةُ إِبْرَاهِيمَ'
    const p = page(4, `قال المصنف رحمه الله: ${vocalised} وهي دين الإسلام.`)
    const anchor: AnnotationAnchor = {
      ...anchorFor(vocalised, p),
      startOffset: 0,
      endOffset: 4,
      textBefore: '',
      textAfter: '',
    }
    const res = resolveAnchor(anchor, PHRASE, [p])
    expect(res.confidence).toBeGreaterThanOrEqual(0.8)
    // The resolved slice is the *vocalised original*, diacritics untouched,
    // with no stray whitespace pulled in from the collapse.
    expect(res.resolvedText).toBe(vocalised)
    expect(normalizeForSearch(res.resolvedText!)).toBe(normalizeForSearch(PHRASE))
  })

  it('4 — falls back to a unique match when the recorded occurrence is stale', () => {
    const p = page(4, `وأصل دين إبراهيم: ${PHRASE} وهو التوحيد.`)
    // The passage used to be the 4th occurrence; the page now holds only one.
    const anchor: AnnotationAnchor = {
      ...anchorFor(PHRASE, p, 3),
      startOffset: 0,
      endOffset: 3,
      textBefore: '',
      textAfter: '',
    }
    const res = resolveAnchor(anchor, PHRASE, [p])
    expect(res.strategy).toBe('unique')
    expect(res.resolvedText).toBe(PHRASE)
  })

  it('5 — follows the passage when it moves to a neighbouring page', () => {
    const p4 = page(4, 'صفحة أخرى لا تحتوي على شيء ذي صلة بهذا الموضوع إطلاقا.')
    const p5 = page(5, `وأصل دين إبراهيم: ${PHRASE} وهو التوحيد.`)
    const anchor = anchorFor(PHRASE, p5, 0, 4)
    const res = resolveAnchor(anchor, PHRASE, [p4, p5])
    expect(res.strategy).toBe('neighbour')
    expect(res.pageNumber).toBe(5)
  })

  it('6 — falls back to stored geometry when the text layer is gone', () => {
    const p = page(4, '')
    const anchor = anchorFor(PHRASE, page(4, PHRASE))
    const res = resolveAnchor(anchor, PHRASE, [p])
    expect(res.strategy).toBe('geometric')
    expect(res.rects).toHaveLength(1)
  })

  it('7 — reports unresolved rather than guessing', () => {
    const p = page(4, 'نص مختلف تماما')
    const anchor = { ...anchorFor(PHRASE, page(4, PHRASE)), rects: [] }
    const res = resolveAnchor(anchor, PHRASE, [p])
    expect(res.strategy).toBe('unresolved')
    expect(res.confidence).toBe(0)
  })

  it('never throws when there are no pages at all', () => {
    const anchor = anchorFor(PHRASE, page(4, PHRASE))
    expect(() => resolveAnchor(anchor, PHRASE, [])).not.toThrow()
  })
})
