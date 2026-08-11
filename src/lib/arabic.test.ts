import { describe, expect, it } from 'vitest'
import {
  STRICT_PROFILE,
  detectLanguage,
  findAllOccurrences,
  mapRangeToSource,
  normalize,
  normalizeForSearch,
} from './arabic'

// Real strings from the books this is built for, not lorem ipsum.
const PLAIN = 'الحنيفية ملة إبراهيم'
const VOCALISED = 'ٱلْحَنِيفِيَّةُ مِلَّةُ إِبْرَاهِيمَ'
const OPENING = 'واعلم رحمك الله أنه يجب علينا تعلم أربع مسائل'

describe('normalize', () => {
  it('folds a fully vocalised phrase onto its bare form', () => {
    expect(normalizeForSearch(VOCALISED)).toBe(normalizeForSearch(PLAIN))
  })

  it('strips tashkīl, tatwīl and shadda', () => {
    expect(normalizeForSearch('مُحَمَّـــد')).toBe(normalizeForSearch('محمد'))
  })

  it('folds every alif and hamza variant onto bare alif', () => {
    const folded = ['ا', 'أ', 'إ', 'آ', 'ٱ'].map((a) => normalizeForSearch(a + 'بجد'))
    expect(new Set(folded).size).toBe(1)
  })

  it('folds tāʾ marbūṭa and alif maqṣūra', () => {
    expect(normalizeForSearch('مدرسة')).toBe(normalizeForSearch('مدرسه'))
    expect(normalizeForSearch('على')).toBe(normalizeForSearch('علي'))
  })

  it('folds Latin transliteration diacritics too', () => {
    expect(normalizeForSearch('Ḥanīfiyyah')).toBe('hanifiyyah')
    expect(normalizeForSearch('Uṣūl ath-Thalāthah')).toBe('usul ath-thalathah')
  })

  it('maps Arabic-Indic digits to ASCII', () => {
    expect(normalizeForSearch('صفحة ٤٢')).toBe(normalizeForSearch('صفحة 42'))
  })

  it('decomposes Arabic presentation forms', () => {
    // U+FEFB — the ligature form of لا, produced by some older PDF exporters.
    expect(normalizeForSearch('ﻻ إله إلا الله')).toContain(normalizeForSearch('لا'))
  })

  it('collapses whitespace and trims', () => {
    expect(normalizeForSearch('  الحمد   \n لله  ')).toBe('الحمد لله')
  })

  it('never mutates the source string', () => {
    const before = VOCALISED
    normalizeForSearch(VOCALISED)
    expect(VOCALISED).toBe(before)
  })

  it('keeps diacritics under the strict profile', () => {
    expect(normalize(VOCALISED, STRICT_PROFILE).text).toContain('ّ') // shadda
  })

  it('produces a map with exactly one entry per output character', () => {
    const result = normalize(OPENING)
    expect(result.map).toHaveLength(result.text.length)
  })

  it('map indices are non-decreasing and inside the source', () => {
    const { map } = normalize(VOCALISED)
    for (let i = 1; i < map.length; i++) expect(map[i]).toBeGreaterThanOrEqual(map[i - 1])
    expect(Math.max(...map)).toBeLessThan(VOCALISED.length)
  })
})

describe('mapRangeToSource', () => {
  it('recovers the vocalised substring from a bare-form match', () => {
    const page = `قال المصنف: ${VOCALISED} وهي دين الإسلام`
    const norm = normalize(page)
    const needle = normalizeForSearch(PLAIN)
    const at = norm.text.indexOf(needle)
    expect(at).toBeGreaterThan(-1)

    const [start, end] = mapRangeToSource(norm, page, at, at + needle.length)
    const raw = page.slice(start, end)

    // The recovered slice is the *original* text, diacritics intact …
    expect(raw).toContain('ّ')
    // … and it normalises back to what we searched for.
    expect(normalizeForSearch(raw)).toBe(needle)
  })

  it('handles a match at the very end of the string', () => {
    const page = `مقدمة ${PLAIN}`
    const norm = normalize(page)
    const needle = normalizeForSearch(PLAIN)
    const at = norm.text.indexOf(needle)
    const [start, end] = mapRangeToSource(norm, page, at, at + needle.length)
    expect(page.slice(start, end)).toBe(PLAIN)
  })
})

describe('findAllOccurrences', () => {
  it('finds every occurrence including overlaps', () => {
    expect(findAllOccurrences('ababab', 'abab')).toEqual([0, 2])
  })

  it('finds a repeated Arabic sentence', () => {
    const page = `${PLAIN} ثم قال ${PLAIN} مرة أخرى`
    expect(findAllOccurrences(normalizeForSearch(page), normalizeForSearch(PLAIN))).toHaveLength(2)
  })

  it('returns nothing for an empty needle', () => {
    expect(findAllOccurrences('abc', '')).toEqual([])
  })
})

describe('detectLanguage', () => {
  it('recognises Arabic prose', () => {
    expect(detectLanguage(OPENING.repeat(2))).toBe('ar')
  })

  it('recognises English prose', () => {
    expect(detectLanguage('The author begins by mentioning the four matters')).toBe('en')
  })

  it('recognises a bilingual page', () => {
    expect(detectLanguage(`${OPENING} — and the author then explains these four matters clearly`)).toBe(
      'mixed',
    )
  })

  it('does not guess from a scrap', () => {
    expect(detectLanguage('42')).toBe('unknown')
  })
})
