import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import { OcrScheduler } from './OcrScheduler'
import type { PDFDocumentProxy } from '@/services/pdf/pdfjs'
import type { PageRecord } from '@/types'

function pdfStub(pageCount = 8): PDFDocumentProxy {
  return { numPages: pageCount } as unknown as PDFDocumentProxy
}

function emptyPage(documentId: string, pageNumber: number): PageRecord {
  return {
    id: `${documentId}:${pageNumber}`,
    documentId,
    pageNumber,
    text: '',
    normalizedText: '',
    itemOffsets: [],
    width: 400,
    height: 600,
    rotation: 0,
    hasTextLayer: false,
    textSource: 'none',
    indexedAt: 1,
  }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('OcrScheduler', () => {
  it('prioritises the visible page, then neighbours, not the whole book', async () => {
    const seen: number[] = []
    const scheduler = new OcrScheduler(() => pdfStub(80), 'doc', async (_pdf, _id, pageNumber) => {
      seen.push(pageNumber)
      return emptyPage('doc', pageNumber)
    })

    scheduler.prioritize([12])
    await vi.waitFor(() => expect(seen).toEqual([12, 11, 13]))
    expect(scheduler.snapshot().status).toBe('idle')
  })

  it('cancels in-flight work and can retry the same page', async () => {
    let started = 0
    const scheduler = new OcrScheduler(() => pdfStub(3), 'doc', async (_pdf, _id, pageNumber, _p, options) => {
      started += 1
      await new Promise<void>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('OCR cancelled', 'AbortError')))
      })
      return emptyPage('doc', pageNumber)
    })
    scheduler.prioritize([1])
    await vi.waitFor(() => expect(started).toBe(1))
    scheduler.cancel()
    await vi.waitFor(() => expect(scheduler.snapshot().status).toBe('cancelled'))

    started = 0
    scheduler.retry(1)
    await vi.waitFor(() => expect(started).toBe(1))
    scheduler.cancel()
    await vi.waitFor(() => expect(scheduler.snapshot().status).toBe('cancelled'))
  })
})
