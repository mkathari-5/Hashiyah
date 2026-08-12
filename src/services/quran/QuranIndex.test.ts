import { beforeEach, describe, expect, it } from 'vitest'
import {
  __setCorpusForTests,
  formatReference,
  getRange,
  parseReference,
  searchQuran,
  type QuranVerse,
} from './QuranIndex'

const ayatAlKursi: QuranVerse = {
  surah: 2,
  ayah: 255,
  arabic: 'ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ ٱلۡحَيُّ ٱلۡقَيُّومُ',
  translation: 'Allah - there is no deity except Him, the Ever-Living, the Sustainer.',
  surahName: 'The Cow',
  surahNameArabic: 'البقرة',
  surahTransliteration: 'Al-Baqarah',
}

const v256: QuranVerse = {
  ...ayatAlKursi,
  ayah: 256,
  arabic: 'لَآ إِكۡرَاهَ فِي ٱلدِّينِ',
  translation: 'There shall be no compulsion in [acceptance of] the religion.',
}

const v257: QuranVerse = {
  ...ayatAlKursi,
  ayah: 257,
  arabic: 'ٱللَّهُ وَلِيُّ ٱلَّذِينَ ءَامَنُواْ',
  translation: 'Allah is the ally of those who believe.',
}

beforeEach(() => {
  __setCorpusForTests([ayatAlKursi, v256, v257])
})

describe('QuranIndex', () => {
  it('parses numeric references and ranges', () => {
    expect(parseReference('2:255')).toEqual({ surah: 2, start: 255, end: 255 })
    expect(parseReference('2:255-257')).toEqual({ surah: 2, start: 255, end: 257 })
    expect(parseReference('2:255–257')).toEqual({ surah: 2, start: 255, end: 257 })
  })

  it('finds 2:255 via Arabic without requiring tashkīl', async () => {
    const hits = await searchQuran('الله لا اله الا هو الحي القيوم')
    expect(hits[0]?.verse.surah).toBe(2)
    expect(hits[0]?.verse.ayah).toBe(255)
  })

  it('finds by sūrah/āyah reference', async () => {
    const hits = await searchQuran('2:255')
    expect(hits).toHaveLength(1)
    expect(hits[0].verse.arabic).toContain('ٱلۡحَيُّ')
  })

  it('returns a verse range for lookup', async () => {
    const verses = await getRange(2, 255, 257)
    expect(verses.map((v) => v.ayah)).toEqual([255, 256, 257])
    expect(formatReference(verses)).toBe('Al-Baqarah · 2:255–257')
  })

  it('finds by English translation snippet', async () => {
    const hits = await searchQuran('no compulsion')
    expect(hits[0]?.verse.ayah).toBe(256)
  })
})
