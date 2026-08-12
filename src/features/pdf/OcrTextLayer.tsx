import { useEffect, useRef } from 'react'
import type { OcrWordBox } from '@/types'
import type { PageTextContext } from '@/services/annotations/selection'

/**
 * Selectable overlay built from OCR word boxes.
 *
 * Spans are positioned like a pdf.js text layer so the existing selection →
 * Send to Notes path can resolve offsets through `data-i` + `itemOffsets`.
 */
export function OcrTextLayer({
  words,
  pageText,
  itemOffsets,
  pageNumber,
  pageEl,
  onReady,
}: {
  words: OcrWordBox[]
  pageText: string
  itemOffsets: number[]
  pageNumber: number
  pageEl: HTMLElement | null
  onReady: (ctx: PageTextContext | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !pageEl || !words.length) {
      onReady(null)
      return
    }

    el.replaceChildren()
    words.forEach((word, index) => {
      const span = document.createElement('span')
      span.dataset.i = String(index)
      span.textContent = word.text
      span.dir = 'auto'
      span.style.left = `${word.x * 100}%`
      span.style.top = `${word.y * 100}%`
      span.style.width = `${Math.max(word.w * 100, 0.5)}%`
      span.style.height = `${Math.max(word.h * 100, 0.8)}%`
      el.appendChild(span)
    })

    onReady({
      pageNumber,
      pageEl,
      textLayerEl: el,
      pageText,
      itemOffsets,
      rotation: 0,
    })

    return () => onReady(null)
  }, [words, pageText, itemOffsets, pageNumber, pageEl, onReady])

  return <div ref={ref} className="textLayer ocr-text-layer" dir="auto" />
}
