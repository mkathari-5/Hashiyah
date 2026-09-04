import Tesseract from 'tesseract.js'
import { OCR_ENGINE_ID, OCR_MODEL_VERSION, resolveOcrLanguage } from '@/services/ocr/ocrCache'
import type { OcrProvider, OcrRecognizeInput, OcrRecognizeResult } from '@/services/ocr/OcrProvider'
import { orderOcrWords } from '@/services/ocr/readingOrder'
import type { OcrLanguage, OcrWordBox } from '@/types'

/**
 * Local Tesseract.js provider. Arabic + English packs live under `/tesseract`.
 * Recognition runs in Tesseract's own worker, not on the UI thread.
 */

function tessLang(language: OcrLanguage): string {
  const resolved = resolveOcrLanguage(language)
  if (resolved === 'ara') return 'ara'
  if (resolved === 'eng') return 'eng'
  return 'ara+eng'
}

export class TesseractOcrProvider implements OcrProvider {
  readonly id = OCR_ENGINE_ID
  readonly modelVersion = OCR_MODEL_VERSION
  private worker: Promise<Tesseract.Worker> | null = null
  private loadedLang: string | null = null

  private async getWorker(language: OcrLanguage): Promise<Tesseract.Worker> {
    const lang = tessLang(language)
    if (!this.worker) {
      this.worker = Tesseract.createWorker(lang, 1, {
        langPath: '/tesseract',
        gzip: true,
        logger: () => undefined,
      }).then(async (worker) => {
        await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO })
        this.loadedLang = lang
        return worker
      })
      return this.worker
    }
    const worker = await this.worker
    if (this.loadedLang !== lang) {
      await worker.reinitialize(lang)
      this.loadedLang = lang
    }
    return worker
  }

  async recognize(input: OcrRecognizeInput, signal?: AbortSignal): Promise<OcrRecognizeResult> {
    if (signal?.aborted) throw new DOMException('OCR cancelled', 'AbortError')
    const worker = await this.getWorker(input.language)
    if (signal?.aborted) throw new DOMException('OCR cancelled', 'AbortError')

    const result = await worker.recognize(input.canvas)
    if (signal?.aborted) throw new DOMException('OCR cancelled', 'AbortError')

    const pageW = input.canvas.width || 1
    const pageH = input.canvas.height || 1
    const words: OcrWordBox[] = []
    for (const word of result.data.words ?? []) {
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

    const ordered = orderOcrWords(words)
    return {
      text: ordered.text || (result.data.text ?? '').replace(/\r/g, '').trim(),
      words: ordered.words,
      lines: ordered.lines.map((line) => ({ ...line, confidence: result.data.confidence ?? 0 })),
      confidence: result.data.confidence ?? 0,
      pageNumber: input.pageNumber,
      language: resolveOcrLanguage(input.language),
      direction: ordered.direction,
      engine: this.id,
      modelVersion: this.modelVersion,
    }
  }

  async terminate(): Promise<void> {
    if (!this.worker) return
    const worker = await this.worker
    this.worker = null
    this.loadedLang = null
    await worker.terminate()
  }
}

let shared: TesseractOcrProvider | null = null

export function getTesseractProvider(): TesseractOcrProvider {
  if (!shared) shared = new TesseractOcrProvider()
  return shared
}
