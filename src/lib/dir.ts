/**
 * Per-block direction detection.
 *
 * We never set `direction: rtl` on a container holding both scripts — that is
 * what breaks bracket mirroring and digit placement in every app that "supports
 * Arabic". Direction is decided per block from the first *strong* character, and
 * then the browser's own bidi algorithm handles the mixed runs inside it, which
 * it does correctly.
 */

export type Direction = 'ltr' | 'rtl' | 'auto'

// Strong RTL: Hebrew, Arabic, Syriac, Thaana, N'Ko, Arabic Supplement/Extended,
// and the Arabic presentation forms.
const STRONG_RTL =
  /[֐-׿؀-؅؈؋؍؛-ي٭-ٯٱ-ەۥ-ۦۮ-ۯۺ-܍ܐ-ޱ߀-ߪࠀ-ࠕ࠰-࡛ࡠ-ࡪࢠ-ࢬיִ-ﭏﭐ-﷿ﹰ-ﻼ]/
// Strong LTR: the Latin/Greek/Cyrillic core. Digits and punctuation are neutral
// and deliberately excluded — "2024" alone should not force LTR.
const STRONG_LTR = /[A-Za-zÀ-ʯͰ-֏Ⴀ-ჿḀ-῿]/

/**
 * Returns the direction implied by the first strong character, or `fallback`
 * if the text contains none (empty, digits only, punctuation only).
 */
export function detectDirection(text: string, fallback: 'ltr' | 'rtl' = 'ltr'): 'ltr' | 'rtl' {
  for (const ch of text) {
    if (STRONG_RTL.test(ch)) return 'rtl'
    if (STRONG_LTR.test(ch)) return 'ltr'
  }
  return fallback
}

/** True when the string contains at least one strong RTL character. */
export function containsRtl(text: string): boolean {
  return STRONG_RTL.test(text)
}
