/**
 * On-demand page OCR for image-only PDFs.
 *
 * Engine: Tesseract.js (WASM), languages shipped under `/tesseract`.
 * Results are written into the existing `pages` table with `textSource: 'ocr'`
 * so search / copy / Send to Notes reuse the same path as embedded text.
 *
 * Arabic OCR quality is useful but imperfect (diacritics, dense naskh). This is
 * a recogniser, not a second authoritative Muṣḥaf.
 */

import Tesseract from 'tesseract.js'
import { pagesRepo } from '@/db/repos/documents'
import { normalizeForSearch } from '@/lib/arabic'
import { pageId } from '@/lib/id'
import type { OcrWordBox, PageRecord, TextSource } from '@/types'
import type { PDFDocumentProxy } from '@/services/pdf/pdfjs'

export type { OcrWordBox }

export interface OcrPageResult {
  text: string
  words: OcrWordBox[]
  confidence: number
}

export type OcrProgress = { status: string; progress: number }

let workerPromise: Promise<Tesseract.Worker> | null = null

async function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await Tesseract.createWorker('ara+eng', 1, {
        langPath: '/tesseract',
        // Prefer local assets; fall back silently if a pack is missing.
        gzip: true,
        logger: () => undefined,
      })
      await worker.setParameters({
        // Hint RTL script; still allows English mixed lines.
        tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      })
      return worker
    })()
  }
  return workerPromise
}

/** Rasterise a PDF page at OCR-friendly DPI. */
export async function renderPageForOcr(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  targetWidth = 1600,
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const scale = targetWidth / base.width
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create OCR canvas')
  await page.render({ canvas, viewport }).promise
  return { canvas, width: base.width, height: base.height }
}

export async function recogniseCanvas(
  canvas: HTMLCanvasElement,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrPageResult> {
  const worker = await getWorker()
  const result = await worker.recognize(canvas)
  onProgress?.({ status: 'done', progress: 1 })

  const data = result.data
  const words: OcrWordBox[] = []
  const pageW = canvas.width || 1
  const pageH = canvas.height || 1

  for (const word of data.words ?? []) {
    const t = word.text?.trim()
    if (!t) continue
    const b = word.bbox
    words.push({
      text: t,
      x: b.x0 / pageW,
      y: b.y0 / pageH,
      w: (b.x1 - b.x0) / pageW,
      h: (b.y1 - b.y0) / pageH,
    })
  }

  return {
    text: (data.text ?? '').replace(/\r/g, '').trim(),
    words,
    confidence: data.confidence ?? 0,
  }
}

/**
 * OCR a page and persist into `pages`. Returns the updated record.
 * Never overwrites a page that already has embedded text.
 */
export async function ocrPdfPage(
  pdf: PDFDocumentProxy,
  documentId: string,
  pageNumber: number,
  onProgress?: (p: OcrProgress) => void,
): Promise<PageRecord> {
  const existing = await pagesRepo.get(documentId, pageNumber)
  if (existing?.textSource === 'embedded' && existing.hasTextLayer) {
    return existing
  }
  if (existing?.textSource === 'ocr' && existing.hasTextLayer && existing.text.trim()) {
    return existing
  }

  onProgress?.({ status: 'rendering', progress: 0.05 })
  const { canvas, width, height } = await renderPageForOcr(pdf, pageNumber)
  onProgress?.({ status: 'recognising', progress: 0.15 })

  // Rough progress heartbeat while Tesseract runs.
  let tick = 0.15
  const timer = window.setInterval(() => {
    tick = Math.min(0.9, tick + 0.05)
    onProgress?.({ status: 'recognising', progress: tick })
  }, 400)

  let result: OcrPageResult
  try {
    result = await recogniseCanvas(canvas)
  } finally {
    window.clearInterval(timer)
  }

  const itemOffsets: number[] = []
  let cursor = 0
  const parts: string[] = []
  for (const word of result.words) {
    itemOffsets.push(cursor)
    parts.push(word.text)
    cursor += word.text.length + 1
  }
  const text = result.words.length ? parts.join(' ') : result.text

  const record: PageRecord = {
    id: pageId(documentId, pageNumber),
    documentId,
    pageNumber,
    text,
    normalizedText: normalizeForSearch(text),
    itemOffsets: itemOffsets.length ? itemOffsets : [0],
    width,
    height,
    rotation: 0,
    hasTextLayer: text.trim().length > 0,
    textSource: (text.trim().length > 0 ? 'ocr' : 'none') as TextSource,
    indexedAt: Date.now(),
    ocrWords: result.words,
  }

  await pagesRepo.put(record)
  onProgress?.({ status: 'done', progress: 1 })
  return record
}

export function isImageOnlyPage(page: PageRecord | undefined | null): boolean {
  if (!page) return false
  return !page.hasTextLayer || page.textSource === 'none'
}
