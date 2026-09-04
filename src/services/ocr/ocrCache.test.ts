import { describe, expect, it } from 'vitest'
import { ocrCacheKey, OCR_ENGINE_ID, OCR_MODEL_VERSION, resolveOcrLanguage } from './ocrCache'

describe('ocrCacheKey', () => {
  it('includes fingerprint, page, language, engine and model', () => {
    expect(ocrCacheKey({ fingerprint: 'abc', pageNumber: 4, language: 'ara+eng' })).toBe(
      `ocr:abc:4:ara+eng:${OCR_ENGINE_ID}:${OCR_MODEL_VERSION}`,
    )
  })

  it('resolves automatic to Arabic + English', () => {
    expect(resolveOcrLanguage('auto')).toBe('ara+eng')
    expect(ocrCacheKey({ fingerprint: 'abc', pageNumber: 1, language: 'auto' })).toBe(
      ocrCacheKey({ fingerprint: 'abc', pageNumber: 1, language: 'ara+eng' }),
    )
  })

  it('does not collide across pages or languages', () => {
    const a = ocrCacheKey({ fingerprint: 'abc', pageNumber: 1, language: 'ara' })
    const b = ocrCacheKey({ fingerprint: 'abc', pageNumber: 2, language: 'ara' })
    const c = ocrCacheKey({ fingerprint: 'abc', pageNumber: 1, language: 'eng' })
    expect(new Set([a, b, c]).size).toBe(3)
  })
})
