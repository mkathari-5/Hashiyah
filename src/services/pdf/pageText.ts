/**
 * Canonical page text.
 *
 * This is the keystone of the whole anchoring system, so it is deliberately tiny
 * and dependency-free: the importer (which never touches the DOM) and the live
 * text layer (which is pure DOM) must produce byte-identical strings, or every
 * offset stored at selection time would point somewhere else at resolve time.
 *
 * pdf.js's `TextLayer` skips items whose `str` is `undefined` (those are
 * marked-content markers, not text), and pushes one `<span>` per remaining item
 * into `textDivs`. Filtering on exactly the same condition here is what makes
 * `textDivs[i]` correspond to filtered item `i`.
 */

export interface TextItemLike {
  str?: string
  hasEOL?: boolean
}

export interface PageTextResult {
  /** The page's text, in logical (not visual) order. */
  text: string
  /** `itemOffsets[i]` is the index in `text` where filtered item `i` starts. */
  itemOffsets: number[]
  /** The filtered item strings, parallel to `itemOffsets` and to `textDivs`. */
  itemStrings: string[]
}

export function buildPageText(items: readonly TextItemLike[]): PageTextResult {
  const parts: string[] = []
  const itemOffsets: number[] = []
  const itemStrings: string[] = []
  let offset = 0

  for (const item of items) {
    if (item.str === undefined) continue
    itemOffsets.push(offset)
    itemStrings.push(item.str)
    parts.push(item.str)
    offset += item.str.length
    if (item.hasEOL) {
      parts.push('\n')
      offset += 1
    }
  }

  return { text: parts.join(''), itemOffsets, itemStrings }
}

/** Which item contains character `offset`? Binary search over `itemOffsets`. */
export function itemIndexAtOffset(itemOffsets: readonly number[], offset: number): number {
  if (itemOffsets.length === 0) return -1
  let lo = 0
  let hi = itemOffsets.length - 1
  let best = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (itemOffsets[mid] <= offset) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}
