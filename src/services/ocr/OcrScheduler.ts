import { hasUsableTextLayer, isImageOnlyPage, ocrPdfPage, type OcrProgress } from '@/services/ocr/OcrService'
import { pagesRepo } from '@/db/repos/documents'
import type { OcrLanguage } from '@/types'
import type { PDFDocumentProxy } from '@/services/pdf/pdfjs'

/**
 * Progressive OCR: current page, then neighbours, never the whole book first.
 */

export type OcrSchedulerListener = (state: {
  pageNumber: number | null
  progress: number
  status: string
  error: string | null
  queue: number[]
}) => void

export class OcrScheduler {
  private queue: number[] = []
  private running = false
  private abort: AbortController | null = null
  private listeners = new Set<OcrSchedulerListener>()
  private lastError: string | null = null
  private currentPage: number | null = null
  private progress = 0
  private status = 'idle'
  private language: OcrLanguage = 'ara+eng'

  private getPdf: () => PDFDocumentProxy | null
  private documentId: string
  private runPage: typeof ocrPdfPage

  constructor(
    getPdf: () => PDFDocumentProxy | null,
    documentId: string,
    runPage: typeof ocrPdfPage = ocrPdfPage,
  ) {
    this.getPdf = getPdf
    this.documentId = documentId
    this.runPage = runPage
  }

  setLanguage(language: OcrLanguage) {
    this.language = language
  }

  subscribe(listener: OcrSchedulerListener) {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  snapshot() {
    return {
      pageNumber: this.currentPage,
      progress: this.progress,
      status: this.status,
      error: this.lastError,
      queue: [...this.queue],
    }
  }

  private emit() {
    const snap = this.snapshot()
    for (const listener of this.listeners) listener(snap)
  }

  prioritize(visible: number[], neighbourRadius = 1) {
    const set = new Set<number>()
    for (const page of visible) {
      set.add(page)
      for (let d = 1; d <= neighbourRadius; d++) {
        set.add(page - d)
        set.add(page + d)
      }
    }
    const maxPage = Number(this.getPdf()?.numPages) || Number.POSITIVE_INFINITY
    this.queue = [...set].filter((n) => n >= 1 && n <= maxPage).sort((a, b) => {
      const vis = visible[0] ?? 1
      return Math.abs(a - vis) - Math.abs(b - vis) || a - b
    })
    this.emit()
    void this.pump()
  }

  retry(pageNumber: number) {
    this.queue = [pageNumber, ...this.queue.filter((n) => n !== pageNumber)]
    this.emit()
    void this.pump({ force: true })
  }

  cancel() {
    this.queue = []
    this.abort?.abort()
    this.abort = null
    this.running = false
    this.status = 'cancelled'
    this.emit()
  }

  async pump(options: { force?: boolean; language?: OcrLanguage } = {}) {
    if (this.running) return
    const pdf = this.getPdf()
    if (!pdf) return
    this.running = true
    this.abort = new AbortController()
    const language = options.language ?? this.language

    while (this.queue.length) {
      const pageNumber = this.queue.shift()!
      const existing = await pagesRepo.get(this.documentId, pageNumber)
      if (!options.force && (hasUsableTextLayer(existing) || (existing?.textSource === 'ocr' && existing.hasTextLayer))) {
        continue
      }
      if (!options.force && existing && !isImageOnlyPage(existing) && existing.textSource !== 'ocr') continue

      this.currentPage = pageNumber
      this.status = 'recognising'
      this.progress = 0
      this.lastError = null
      this.emit()
      try {
        await this.runPage(
          pdf,
          this.documentId,
          pageNumber,
          (p: OcrProgress) => {
            this.progress = p.progress
            this.status = p.status
            this.emit()
          },
          { language, force: options.force, signal: this.abort.signal },
        )
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') break
        this.lastError = error instanceof Error ? error.message : 'OCR failed'
        this.status = 'error'
        this.emit()
      }
    }

    this.running = false
    this.currentPage = null
    this.progress = this.status === 'error' ? this.progress : 1
    if (this.status !== 'error' && this.status !== 'cancelled') this.status = 'idle'
    this.emit()
  }
}
