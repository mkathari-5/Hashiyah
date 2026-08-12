import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { pagesRepo } from '@/db/repos/documents'
import { isImageOnlyPage } from './OcrService'

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('image-only page detection', () => {
  it('treats pages with no text layer as image-only', () => {
    expect(
      isImageOnlyPage({
        id: 'd:1',
        documentId: 'd',
        pageNumber: 1,
        text: '',
        normalizedText: '',
        itemOffsets: [],
        width: 100,
        height: 100,
        rotation: 0,
        hasTextLayer: false,
        textSource: 'none',
        indexedAt: 1,
      }),
    ).toBe(true)
  })

  it('does not treat embedded or OCR pages as image-only once they have text', () => {
    expect(
      isImageOnlyPage({
        id: 'd:1',
        documentId: 'd',
        pageNumber: 1,
        text: 'مرحبا',
        normalizedText: 'مرحبا',
        itemOffsets: [0],
        width: 100,
        height: 100,
        rotation: 0,
        hasTextLayer: true,
        textSource: 'ocr',
        indexedAt: 1,
        ocrWords: [{ text: 'مرحبا', x: 0.1, y: 0.1, w: 0.2, h: 0.05 }],
      }),
    ).toBe(false)
  })
})

describe('OCR persistence', () => {
  it('stores OCR text and word boxes on the pages table without schema migration', async () => {
    await pagesRepo.put({
      id: 'doc:3',
      documentId: 'doc',
      pageNumber: 3,
      text: 'كلمة',
      normalizedText: 'كلمة',
      itemOffsets: [0],
      width: 200,
      height: 300,
      rotation: 0,
      hasTextLayer: true,
      textSource: 'ocr',
      indexedAt: Date.now(),
      ocrWords: [{ text: 'كلمة', x: 0.2, y: 0.3, w: 0.15, h: 0.04 }],
    })

    const row = await pagesRepo.get('doc', 3)
    expect(row?.textSource).toBe('ocr')
    expect(row?.hasTextLayer).toBe(true)
    expect(row?.text).toBe('كلمة')
    expect(row?.ocrWords?.[0]?.text).toBe('كلمة')
  })
})
