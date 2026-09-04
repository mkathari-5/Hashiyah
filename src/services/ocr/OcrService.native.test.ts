import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { pagesRepo } from '@/db/repos/documents'
import { ocrResultsRepo } from '@/db/repos/pageMarks'
import { ocrCacheKey } from '@/services/ocr/ocrCache'
import { isUsableNativeText, ocrPdfPage, setOcrProvider } from '@/services/ocr/OcrService'
import type { OcrProvider } from '@/services/ocr/OcrProvider'
import type { PDFDocumentProxy } from '@/services/pdf/pdfjs'
import type { OcrResult } from '@/types'

function mockPdf(pages: { text: string }[]): PDFDocumentProxy {
  return {
    numPages: pages.length,
    getPage: async (n: number) => {
      const spec = pages[n - 1] ?? { text: '' }
      return {
        rotate: 0,
        getViewport: ({ scale = 1 }: { scale?: number }) => ({
          width: 400 * scale,
          height: 600 * scale,
          rotation: 0,
        }),
        getTextContent: async () => ({ items: spec.text ? [{ str: spec.text }] : [] }),
        render: () => ({ promise: Promise.resolve(), cancel() {} }),
        cleanup() {},
      }
    },
  } as unknown as PDFDocumentProxy
}

const mockProvider: OcrProvider = {
  id: 'mock',
  modelVersion: 'test',
  async recognize() {
    throw new Error('provider should not run')
  },
  async terminate() {},
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  setOcrProvider(mockProvider)
})

describe('native text vs OCR', () => {
  it('treats a short English sentence as usable native text', () => {
    expect(isUsableNativeText('In the name of Allah')).toBe(true)
    expect(isUsableNativeText('  \n  ')).toBe(false)
  })

  it('uses an English text layer instead of OCR', async () => {
    const page = await ocrPdfPage(mockPdf([{ text: 'The opening chapter of the book.' }]), 'doc_en', 1)
    expect(page.textSource).toBe('embedded')
    expect(page.text).toContain('opening chapter')
  })

  it('uses an Arabic text layer instead of OCR', async () => {
    const page = await ocrPdfPage(mockPdf([{ text: 'بسم الله الرحمن الرحيم' }]), 'doc_ar', 1)
    expect(page.textSource).toBe('embedded')
    expect(page.text).toBe('بسم الله الرحمن الرحيم')
  })

  it('reuses a cached OCR result for a scanned Arabic page', async () => {
    await db.documents.put({
      id: 'doc_scan',
      bookId: 'bk',
      filename: 'scan.pdf',
      byteLength: 10,
      fingerprint: 'fp-scan',
      pageCount: 1,
      createdAt: 1,
    })
    const cached: OcrResult = {
      id: ocrCacheKey({ fingerprint: 'fp-scan', pageNumber: 1, language: 'ara+eng' }),
      documentId: 'doc_scan',
      fingerprint: 'fp-scan',
      pageNumber: 1,
      language: 'ara+eng',
      engine: 'mock',
      modelVersion: 'test',
      text: 'الحمد لله',
      words: [{ text: 'الحمد', x: 0.5, y: 0.2, w: 0.2, h: 0.04 }, { text: 'لله', x: 0.3, y: 0.2, w: 0.15, h: 0.04 }],
      lines: [],
      confidence: 90,
      direction: 'rtl',
      createdAt: 1,
    }
    await ocrResultsRepo.put(cached)

    const page = await ocrPdfPage(mockPdf([{ text: '' }]), 'doc_scan', 1)
    expect(page.textSource).toBe('ocr')
    expect(page.text).toContain('الحمد')
    expect(page.ocrWords?.[0]?.text).toBe('الحمد')
  })

  it('leaves a native-text page alone in a mixed document', async () => {
    const native = await ocrPdfPage(mockPdf([{ text: 'Page one has a text layer.' }, { text: '' }]), 'doc_mix', 1)
    expect(native.textSource).toBe('embedded')
    const stored = await pagesRepo.get('doc_mix', 1)
    expect(stored?.textSource).toBe('embedded')
  })
})
