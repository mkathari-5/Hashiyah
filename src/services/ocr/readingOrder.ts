import { containsRtl } from '@/lib/dir'
import type { OcrLine, OcrWordBox } from '@/types'

/**
 * Rebuild reading order from bounding boxes.
 *
 * Tesseract's `data.text` follows its internal scan order, which is often
 * wrong for RTL naskh. We cluster words into lines by vertical overlap, then
 * sort each line right-to-left when the line is Arabic-majority.
 */

const LINE_OVERLAP = 0.45

export function clusterOcrLines(words: OcrWordBox[]): OcrWordBox[][] {
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: OcrWordBox[][] = []
  for (const word of sorted) {
    const last = lines[lines.length - 1]
    if (!last) {
      lines.push([word])
      continue
    }
    const sample = last[0]!
    const overlap = Math.min(sample.y + sample.h, word.y + word.h) - Math.max(sample.y, word.y)
    const minH = Math.min(sample.h, word.h) || 1
    if (overlap / minH >= LINE_OVERLAP) last.push(word)
    else lines.push([word])
  }
  return lines
}

export function orderOcrWords(words: OcrWordBox[]): { words: OcrWordBox[]; lines: OcrLine[]; text: string; direction: 'rtl' | 'ltr' | 'mixed' } {
  const clustered = clusterOcrLines(words)
  const lines: OcrLine[] = clustered.map((lineWords) => {
    const rtlCount = lineWords.filter((w) => containsRtl(w.text)).length
    const direction: 'rtl' | 'ltr' = rtlCount >= lineWords.length / 2 ? 'rtl' : 'ltr'
    const ordered = [...lineWords].sort((a, b) => (direction === 'rtl' ? b.x - a.x : a.x - b.x))
    return {
      text: ordered.map((w) => w.text).join(' '),
      words: ordered,
      confidence: 0,
      direction,
    }
  })
  const rtlLines = lines.filter((line) => line.direction === 'rtl').length
  const direction: 'rtl' | 'ltr' | 'mixed' =
    rtlLines === 0 ? 'ltr' : rtlLines === lines.length ? 'rtl' : 'mixed'
  const orderedWords = lines.flatMap((line) => line.words)
  return {
    words: orderedWords,
    lines,
    text: lines.map((line) => line.text).join('\n'),
    direction,
  }
}
