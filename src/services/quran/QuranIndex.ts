/**
 * Local Qurʾān corpus — search and verse/range lookup.
 *
 * Arabic text and Saheeh International English are bundled under
 * `public/quran/quran_en.json` (see NOTICE.md). Nothing here invents āyāt or
 * translations; every inserted verse comes from this dataset.
 */

import { normalizeForSearch } from '@/lib/arabic'

export const QURAN_TRANSLATION_ID = 'en.sahih'
export const QURAN_TRANSLATION_LABEL = 'Saheeh International'

export interface QuranVerse {
  surah: number
  ayah: number
  arabic: string
  translation: string
  surahName: string
  surahNameArabic: string
  surahTransliteration: string
}

export interface QuranHit {
  verse: QuranVerse
  score: number
}

interface RawSurah {
  id: number
  name: string
  transliteration: string
  translation: string
  verses: { id: number; text: string; translation: string }[]
}

let corpus: QuranVerse[] | null = null
let loadPromise: Promise<QuranVerse[]> | null = null

async function loadCorpus(): Promise<QuranVerse[]> {
  if (corpus) return corpus
  if (!loadPromise) {
    loadPromise = fetch('/quran/quran_en.json')
      .then((r) => {
        if (!r.ok) throw new Error('Qurʾān corpus could not be loaded')
        return r.json() as Promise<RawSurah[]>
      })
      .then((surahs) => {
        const verses: QuranVerse[] = []
        for (const s of surahs) {
          for (const v of s.verses) {
            verses.push({
              surah: s.id,
              ayah: v.id,
              arabic: v.text,
              translation: v.translation,
              surahName: s.translation,
              surahNameArabic: s.name,
              surahTransliteration: s.transliteration,
            })
          }
        }
        corpus = verses
        return verses
      })
  }
  return loadPromise
}

/** Parse "2:255", "2:255-257", "Al-Baqarah 255", etc. */
export function parseReference(query: string): { surah: number; start: number; end: number } | null {
  const trimmed = query.trim()
  const numeric = trimmed.match(/^(\d{1,3})\s*[:：]\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/)
  if (numeric) {
    const surah = Number(numeric[1])
    const start = Number(numeric[2])
    const end = numeric[3] ? Number(numeric[3]) : start
    if (surah < 1 || surah > 114 || start < 1 || end < start) return null
    return { surah, start, end }
  }
  return null
}

function resolveNamedReference(
  query: string,
  all: QuranVerse[],
): { surah: number; start: number; end: number } | null {
  const named = query
    .trim()
    .match(/^([A-Za-zĀ-žʾʿ'\-\s]+?)\s+(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/)
  if (!named) return null
  const key = normalizeForSearch(named[1]).replace(/\s+/g, '')
  const match = all.find(
    (v) =>
      v.ayah === 1 &&
      (normalizeForSearch(v.surahTransliteration).replace(/\s+/g, '').includes(key) ||
        normalizeForSearch(v.surahName).replace(/\s+/g, '').includes(key)),
  )
  if (!match) return null
  const start = Number(named[2])
  const end = named[3] ? Number(named[3]) : start
  if (start < 1 || end < start) return null
  return { surah: match.surah, start, end }
}

export async function getVerse(surah: number, ayah: number): Promise<QuranVerse | null> {
  const all = await loadCorpus()
  return all.find((v) => v.surah === surah && v.ayah === ayah) ?? null
}

export async function getRange(surah: number, start: number, end: number): Promise<QuranVerse[]> {
  const all = await loadCorpus()
  return all.filter((v) => v.surah === surah && v.ayah >= start && v.ayah <= end)
}

export function formatReference(verses: QuranVerse[]): string {
  if (!verses.length) return ''
  const first = verses[0]
  const last = verses[verses.length - 1]
  const name = first.surahTransliteration
  const nums =
    first.ayah === last.ayah
      ? `${first.surah}:${first.ayah}`
      : `${first.surah}:${first.ayah}–${last.ayah}`
  return `${name} · ${nums}`
}

export async function searchQuran(query: string, limit = 12): Promise<QuranHit[]> {
  const all = await loadCorpus()
  const q = query.trim()
  if (!q) return []

  const named = resolveNamedReference(q, all)
  const ref = named ?? parseReference(q)
  if (ref) {
    const verses = await getRange(ref.surah, ref.start, ref.end)
    if (verses[0]) return [{ verse: verses[0], score: 1000 }]
  }

  const needle = normalizeForSearch(q)
  if (needle.length < 2) return []

  const hits: QuranHit[] = []
  for (const verse of all) {
    const ar = normalizeForSearch(verse.arabic)
    const en = normalizeForSearch(verse.translation)
    const name = normalizeForSearch(verse.surahTransliteration)
    let score = 0
    if (ar.includes(needle)) {
      score += 50 + Math.max(0, 20 - (ar.indexOf(needle) / Math.max(ar.length, 1)) * 20)
    }
    if (en.includes(needle)) score += 30
    if (name.includes(needle)) score += 10
    if (score > 0) hits.push({ verse, score })
  }

  hits.sort((a, b) => b.score - a.score || a.verse.surah - b.verse.surah || a.verse.ayah - b.verse.ayah)
  return hits.slice(0, limit)
}

/** Warm the corpus (call once after app hydrate). */
export function preloadQuran(): void {
  void loadCorpus().catch(() => undefined)
}

/** Test helper — inject a tiny corpus without fetch. */
export function __setCorpusForTests(verses: QuranVerse[] | null): void {
  corpus = verses
  loadPromise = verses ? Promise.resolve(verses) : null
}
