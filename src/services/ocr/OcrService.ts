import { documentsRepo, pagesRepo } from '@/db/repos/documents'
import { ocrResultsRepo } from '@/db/repos/pageMarks'
import { normalizeForSearch } from '@/lib/arabic'
import { pageId } from '@/lib/id'
import { ocrCacheKey, OCR_ENGINE_ID, OCR_MODEL_VERSION, resolveOcrLanguage } from '@/services/ocr/ocrCache'
import { getTesseractProvider } from '@/services/ocr/TesseractOcrProvider'
import type { OcrProvider } from '@/services/ocr/OcrProvider'
import { buildPageText } from '@/services/pdf/pageText'
import type { OcrLanguage, OcrResult, PageRecord, TextSource } from '@/types'
import type { PDFDocumentProxy } from '@/services/pdf/pdfjs'

export type { OcrWordBox } from '@/types'
export type OcrProgress = { status: string; progress: number; pageNumber?: number }

let provider: OcrProvider = getTesseractProvider()

export function setOcrProvider(next: OcrProvider) {
  provider = next
}

export function getOcrProvider(): OcrProvider {
  return provider
}

export function isImageOnlyPage(page: PageRecord | undefined | null): boolean {
  if (!page) return false
  return !page.hasTextLayer || page.textSource === 'none'
}

export function hasUsableTextLayer(page: PageRecord | undefined | null): boolean {
  if (!page) return false
  return page.hasTextLayer && page.textSource === 'embedded' && isUsableNativeText(page.text)
}

/** Enough real characters to prefer the PDF text layer over OCR. */
export function isUsableNativeText(text: string): boolean {
  return text.replace(/\s+/g, ' ').trim().length >= 8
}

export async function readEmbeddedPageText(
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<{ text: string; itemOffsets: number[]; width: number; height: number; rotation: number }> {
  const page = await pdf.getPage(pageNumber)
  const content = await page.getTextContent()
  const items = content.items as { str?: string; hasEOL?: boolean }[]
  const { text, itemOffsets } = buildPageText(items)
  const base = page.getViewport({ scale: 1 })
  return { text, itemOffsets, width: base.width, height: base.height, rotation: base.rotation }
}

function preprocessForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return source
  ctx.filter = 'contrast(1.12) brightness(1.04)'
  ctx.drawImage(source, 0, 0)
  ctx.filter = 'none'
  return canvas
}

export async function renderPageForOcr(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  targetWidth = 1600,
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number; rotation: number }> {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const scale = targetWidth / base.width
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create OCR canvas')
  await page.render({ canvas, viewport, intent: 'print' }).promise
  return { canvas: preprocessForOcr(canvas), width: base.width, height: base.height, rotation: base.rotation }
}

export async function ocrPdfPage(
  pdf: PDFDocumentProxy,
  documentId: string,
  pageNumber: number,
  onProgress?: (p: OcrProgress) => void,
  options: { language?: OcrLanguage; force?: boolean; signal?: AbortSignal } = {},
): Promise<PageRecord> {
  const language = options.language ?? 'ara+eng'
  if (options.signal?.aborted) throw new DOMException('OCR cancelled', 'AbortError')

  const existing = await pagesRepo.get(documentId, pageNumber)
  if (!options.force && existing && hasUsableTextLayer(existing)) return existing
  if (
    !options.force &&
    existing?.textSource === 'ocr' &&
    existing.hasTextLayer &&
    existing.text.trim() &&
    (!existing.ocrLanguage || existing.ocrLanguage === resolveOcrLanguage(language))
  ) {
    return existing
  }

  const embedded = await readEmbeddedPageText(pdf, pageNumber)
  if (!options.force && isUsableNativeText(embedded.text)) {
    const record: PageRecord = {
      id: pageId(documentId, pageNumber),
      documentId,
      pageNumber,
      text: embedded.text,
      normalizedText: normalizeForSearch(embedded.text),
      itemOffsets: embedded.itemOffsets,
      width: embedded.width,
      height: embedded.height,
      rotation: embedded.rotation,
      hasTextLayer: true,
      textSource: 'embedded',
      indexedAt: Date.now(),
    }
    await pagesRepo.put(record)
    return record
  }

  const meta = await documentsRepo.get(documentId)
  const fingerprint = meta?.fingerprint ?? documentId
  const cacheId = ocrCacheKey({ fingerprint, pageNumber, language })
  const cached = await ocrResultsRepo.get(cacheId)
  if (!options.force && cached) {
    return persistOcrPage(documentId, pageNumber, existing, cached, {
      width: embedded.width,
      height: embedded.height,
      rotation: embedded.rotation,
    })
  }

  onProgress?.({ status: 'rendering', progress: 0.05, pageNumber })
  const { canvas, width, height, rotation } = await renderPageForOcr(pdf, pageNumber)
  if (options.signal?.aborted) throw new DOMException('OCR cancelled', 'AbortError')
  onProgress?.({ status: 'recognising', progress: 0.2, pageNumber })

  const recognised = await provider.recognize({ canvas, pageNumber, language }, options.signal)
  if (options.signal?.aborted) throw new DOMException('OCR cancelled', 'AbortError')
  const row: OcrResult = {
    id: cacheId,
    documentId,
    fingerprint,
    pageNumber,
    language: resolveOcrLanguage(language),
    engine: recognised.engine || OCR_ENGINE_ID,
    modelVersion: recognised.modelVersion || OCR_MODEL_VERSION,
    text: recognised.text,
    words: recognised.words,
    lines: recognised.lines,
    confidence: recognised.confidence,
    direction: recognised.direction,
    createdAt: Date.now(),
  }
  await ocrResultsRepo.put(row)
  onProgress?.({ status: 'done', progress: 1, pageNumber })
  return persistOcrPage(documentId, pageNumber, existing, row, { width, height, rotation })
}

async function persistOcrPage(
  documentId: string,
  pageNumber: number,
  existing: PageRecord | undefined,
  row: OcrResult,
  geometry?: { width: number; height: number; rotation: number },
): Promise<PageRecord> {
  const itemOffsets: number[] = []
  let cursor = 0
  const parts: string[] = []
  for (const word of row.words) {
    itemOffsets.push(cursor)
    parts.push(word.text)
    cursor += word.text.length + 1
  }
  const text = row.words.length ? parts.join(' ') : row.text
  const record: PageRecord = {
    id: pageId(documentId, pageNumber),
    documentId,
    pageNumber,
    text,
    normalizedText: normalizeForSearch(text),
    itemOffsets: itemOffsets.length ? itemOffsets : [0],
    width: geometry?.width ?? existing?.width ?? 1,
    height: geometry?.height ?? existing?.height ?? 1,
    rotation: geometry?.rotation ?? existing?.rotation ?? 0,
    hasTextLayer: text.trim().length > 0,
    textSource: (text.trim().length > 0 ? 'ocr' : 'none') as TextSource,
    indexedAt: Date.now(),
    ocrWords: row.words,
    ocrLanguage: row.language,
    ocrEngine: row.engine,
    ocrModelVersion: row.modelVersion,
    ocrConfidence: row.confidence,
    ocrDirection: row.direction,
  }
  await pagesRepo.put(record)
  return record
}

export async function terminateOcr(): Promise<void> {
  await provider.terminate()
}
