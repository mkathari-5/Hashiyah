/**
 * Arabic text handling.
 *
 * The single most important guarantee in this file: normalisation is *never*
 * destructive to stored data, and it always returns an index map back to the
 * original string. Every downstream feature — search highlighting, anchor
 * resolution, occurrence counting — depends on being able to say "normalised
 * character 37 came from raw character 52".
 *
 * Nothing here mutates the caller's string.
 */

export interface NormalizationOptions {
  /** Remove combining marks: Arabic tashkīl *and* Latin transliteration accents. */
  stripDiacritics: boolean
  /** Remove kashīdah / tatwīl (U+0640). */
  stripTatweel: boolean
  /** Fold alif wasla → alif, alif maqsūra → yāʾ, tāʾ marbūṭa → hāʾ. */
  foldLetters: boolean
  /** Arabic-Indic and Eastern Arabic-Indic digits → ASCII. */
  foldDigits: boolean
  /** Collapse runs of whitespace to a single space and trim ends. */
  collapseWhitespace: boolean
  /** Latin lowercase. */
  lowercase: boolean
}

/** Used for search and for anchor matching. Deliberately aggressive. */
export const SEARCH_PROFILE: NormalizationOptions = {
  stripDiacritics: true,
  stripTatweel: true,
  foldLetters: true,
  foldDigits: true,
  collapseWhitespace: true,
  lowercase: true,
}

/** Used when the user turns "ignore diacritics" off: whitespace only. */
export const STRICT_PROFILE: NormalizationOptions = {
  stripDiacritics: false,
  stripTatweel: false,
  foldLetters: false,
  foldDigits: false,
  collapseWhitespace: true,
  lowercase: true,
}

export interface NormalizedText {
  /** The normalised string. */
  text: string
  /**
   * `map[i]` is the index in the *source* string of the character that produced
   * normalised character `i`. Length always equals `text.length`.
   */
  map: number[]
}

const COMBINING = /\p{Mn}/u
const TATWEEL = 'ـ'

const LETTER_FOLDS: Record<string, string> = {
  'ٱ': 'ا', // ٱ alif wasla   → ا
  'ى': 'ي', // ى alif maqsūra → ي
  'ة': 'ه', // ة tāʾ marbūṭa  → ه
  'آ': 'ا', // آ (belt & braces; NFD normally handles it)
  'أ': 'ا', // أ
  'إ': 'ا', // إ
  'ؤ': 'و', // ؤ
  'ئ': 'ي', // ئ
}

function foldDigit(ch: string): string | null {
  const c = ch.codePointAt(0)!
  if (c >= 0x0660 && c <= 0x0669) return String.fromCharCode(0x30 + (c - 0x0660)) // ٠-٩
  if (c >= 0x06f0 && c <= 0x06f9) return String.fromCharCode(0x30 + (c - 0x06f0)) // ۰-۹
  return null
}

/**
 * Expand a single source character into its decomposed form.
 * Arabic presentation forms (U+FB50–U+FEFF) are the only place we reach for the
 * compatibility (NFKC) decomposition, because those codepoints are ligature
 * artefacts of old PDF producers and carry no semantic distinction.
 */
function expand(ch: string): string {
  const c = ch.codePointAt(0)!
  const compat = c >= 0xfb50 && c <= 0xfeff ? ch.normalize('NFKC') : ch
  return compat.normalize('NFD')
}

/**
 * Normalise `src`, returning the result together with an index map back into
 * `src`. Pure; `src` is never modified.
 */
export function normalize(src: string, opts: NormalizationOptions = SEARCH_PROFILE): NormalizedText {
  const out: string[] = []
  const map: number[] = []
  let pendingSpace = false
  let sawContent = false

  for (let i = 0; i < src.length; ) {
    const cp = src.codePointAt(i)!
    const ch = String.fromCodePoint(cp)
    const srcIndex = i
    i += ch.length

    // Whitespace handling happens before decomposition so we never emit
    // half-collapsed runs.
    if (/\s/.test(ch)) {
      if (opts.collapseWhitespace) {
        if (sawContent) pendingSpace = true
      } else {
        out.push(ch)
        map.push(srcIndex)
        sawContent = true
      }
      continue
    }

    for (const piece of expand(ch)) {
      if (opts.stripDiacritics && COMBINING.test(piece)) continue
      if (opts.stripTatweel && piece === TATWEEL) continue

      let emitted = piece
      if (opts.foldLetters && LETTER_FOLDS[emitted]) emitted = LETTER_FOLDS[emitted]
      if (opts.foldDigits) {
        const d = foldDigit(emitted)
        if (d !== null) emitted = d
      }
      if (opts.lowercase) emitted = emitted.toLowerCase()
      if (emitted === '') continue

      if (pendingSpace) {
        out.push(' ')
        map.push(srcIndex)
        pendingSpace = false
      }
      for (const c of emitted) {
        out.push(c)
        map.push(srcIndex)
      }
      sawContent = true
    }
  }

  return { text: out.join(''), map }
}

/** Convenience for callers that do not need the index map. */
export function normalizeForSearch(src: string, opts: NormalizationOptions = SEARCH_PROFILE): string {
  return normalize(src, opts).text
}

/**
 * Translate a `[start, end)` range in normalised space back to a `[start, end)`
 * range in the source string.
 *
 * The end index maps to the *start of the next kept character*, which means
 * characters dropped during normalisation are pulled back into the range. That
 * is what we want for diacritics — a trailing shadda belongs to the letter
 * before it — but not for collapsed whitespace, which would leave a stray space
 * on the end of every quotation. So trailing whitespace is trimmed back off.
 */
export function mapRangeToSource(
  norm: NormalizedText,
  source: string,
  start: number,
  end: number,
): [number, number] {
  if (norm.map.length === 0) return [0, 0]
  const clampedStart = Math.max(0, Math.min(start, norm.map.length - 1))
  const rawStart = norm.map[clampedStart]
  let rawEnd = end >= norm.map.length ? source.length : norm.map[end]
  while (rawEnd > rawStart && /\s/.test(source[rawEnd - 1])) rawEnd--
  return [rawStart, Math.max(rawStart, rawEnd)]
}

/** All start indices of `needle` in `haystack`, including overlapping matches. */
export function findAllOccurrences(haystack: string, needle: string): number[] {
  if (!needle) return []
  const hits: number[] = []
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) break
    hits.push(at)
    from = at + 1
  }
  return hits
}

/** Arabic, Arabic Supplement, Extended-A/B, and the presentation-form blocks. */
const ARABIC_LETTER = /[ؠ-يٮ-ۓۺ-ۿݐ-ݿࢠ-ࢿﭐ-﷿ﹰ-﻿]/
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/

/** Rough language read used for book metadata and font selection. Never authoritative. */
export function detectLanguage(text: string): 'ar' | 'en' | 'mixed' | 'unknown' {
  let ar = 0
  let la = 0
  for (const ch of text) {
    if (ARABIC_LETTER.test(ch)) ar++
    else if (LATIN_LETTER.test(ch)) la++
  }
  const total = ar + la
  if (total < 12) return 'unknown'
  const arRatio = ar / total
  if (arRatio > 0.85) return 'ar'
  if (arRatio < 0.15) return 'en'
  return 'mixed'
}

export function hasArabic(text: string): boolean {
  return ARABIC_LETTER.test(text)
}
