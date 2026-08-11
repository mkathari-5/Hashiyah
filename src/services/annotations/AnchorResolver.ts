import { findAllOccurrences, mapRangeToSource, normalize } from '@/lib/arabic'
import type { AnchorResolution, AnnotationAnchor, PageRecord } from '@/types'

/**
 * AnchorResolver — given a stored anchor and the pages we have text for, work
 * out where in the document it points *today*.
 *
 * The design assumption is that any single signal can rot: offsets shift if the
 * text extractor changes, the surrounding context changes if the page is
 * re-OCR'd, coordinates change if the file is re-exported. So the anchor stores
 * six overlapping signals and this cascade tries them strongest-first, reporting
 * which one succeeded and how much to trust it.
 *
 * It never throws and never returns null. The worst outcome is
 * `strategy: 'unresolved'`, which the UI shows as a quiet badge on the
 * quotation — the note itself is never touched.
 *
 * Pure: no DOM, no database, no pdf.js. This is what makes it testable.
 */

const CONFIDENCE: Record<AnchorResolution['strategy'], number> = {
  exact: 1,
  context: 0.95,
  occurrence: 0.85,
  unique: 0.8,
  neighbour: 0.6,
  geometric: 0.3,
  unresolved: 0,
}

function result(
  strategy: AnchorResolution['strategy'],
  pageNumber: number,
  startOffset: number,
  endOffset: number,
  resolvedText: string | null,
  rects: AnchorResolution['rects'] = [],
): AnchorResolution {
  return {
    strategy,
    confidence: CONFIDENCE[strategy],
    pageNumber,
    startOffset,
    endOffset,
    rects,
    resolvedText,
  }
}

/** Locate `normalizedNeedle` on a page and translate the hit back to raw offsets. */
function locate(page: PageRecord, normalizedNeedle: string, occurrenceIndex: number | null) {
  const norm = normalize(page.text)
  const hits = findAllOccurrences(norm.text, normalizedNeedle)
  if (hits.length === 0) return null

  let hitIndex: number
  if (occurrenceIndex === null) {
    if (hits.length !== 1) return null
    hitIndex = 0
  } else {
    if (occurrenceIndex >= hits.length) return null
    hitIndex = occurrenceIndex
  }

  const at = hits[hitIndex]
  const [rawStart, rawEnd] = mapRangeToSource(norm, page.text, at, at + normalizedNeedle.length)
  return { rawStart, rawEnd, hits: hits.length }
}

export function resolveAnchor(
  anchor: AnnotationAnchor,
  selectedText: string,
  pages: readonly PageRecord[],
): AnchorResolution {
  const normalizedNeedle = normalize(selectedText).text
  const home = pages.find((p) => p.pageNumber === anchor.pageNumber)

  if (normalizedNeedle.length > 0 && home) {
    // 1 — offsets still say what they said when we stored them.
    const atOffsets = home.text.slice(anchor.startOffset, anchor.endOffset)
    if (atOffsets.length > 0 && normalize(atOffsets).text === normalizedNeedle) {
      return result('exact', home.pageNumber, anchor.startOffset, anchor.endOffset, atOffsets)
    }

    // 2 — surrounding context. This is what disambiguates a sentence that
    //     appears five times in the same chapter.
    if (anchor.textBefore || anchor.textAfter) {
      const norm = normalize(home.text)
      const window = normalize(anchor.textBefore + selectedText + anchor.textAfter).text
      const windowAt = norm.text.indexOf(window)
      if (windowAt !== -1) {
        const inner = norm.text.indexOf(normalizedNeedle, windowAt)
        if (inner !== -1 && inner <= windowAt + window.length) {
          const [s, e] = mapRangeToSource(norm, home.text, inner, inner + normalizedNeedle.length)
          return result('context', home.pageNumber, s, e, home.text.slice(s, e))
        }
      }
    }

    // 3 — the Nth occurrence we recorded at capture time.
    const byOccurrence = locate(home, normalizedNeedle, anchor.occurrenceIndex)
    if (byOccurrence) {
      return result(
        'occurrence',
        home.pageNumber,
        byOccurrence.rawStart,
        byOccurrence.rawEnd,
        home.text.slice(byOccurrence.rawStart, byOccurrence.rawEnd),
      )
    }

    // 4 — it appears exactly once on the page, so there is nothing to confuse.
    const unique = locate(home, normalizedNeedle, null)
    if (unique) {
      return result(
        'unique',
        home.pageNumber,
        unique.rawStart,
        unique.rawEnd,
        home.text.slice(unique.rawStart, unique.rawEnd),
      )
    }
  }

  // 5 — the page numbering moved (re-import, different edition, added preface).
  if (normalizedNeedle.length > 0) {
    const neighbours = pages
      .filter((p) => p.pageNumber !== anchor.pageNumber)
      .sort((a, b) => Math.abs(a.pageNumber - anchor.pageNumber) - Math.abs(b.pageNumber - anchor.pageNumber))
    for (const page of neighbours) {
      const hit = locate(page, normalizedNeedle, null)
      if (hit) {
        return result(
          'neighbour',
          page.pageNumber,
          hit.rawStart,
          hit.rawEnd,
          page.text.slice(hit.rawStart, hit.rawEnd),
        )
      }
    }
  }

  // 6 — no text to match against (scanned page, stripped text layer). We still
  //     know where the ink was.
  if (anchor.rects.length > 0) {
    return result('geometric', anchor.pageNumber, anchor.startOffset, anchor.endOffset, null, anchor.rects)
  }

  // 7 — surface it honestly rather than pointing somewhere plausible-but-wrong.
  return result('unresolved', anchor.pageNumber, anchor.startOffset, anchor.endOffset, null)
}

/** Anything below this is shown to the user as "source moved — check this". */
export const TRUSTED_CONFIDENCE = 0.8
