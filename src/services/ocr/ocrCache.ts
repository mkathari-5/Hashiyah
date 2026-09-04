import type { OcrLanguage } from '@/types'

export const OCR_ENGINE_ID = 'tesseract.js'
export const OCR_MODEL_VERSION = '5.1.1-fast'

export function resolveOcrLanguage(language: OcrLanguage): Exclude<OcrLanguage, 'auto'> {
  return language === 'auto' ? 'ara+eng' : language
}

export function ocrCacheKey(input: {
  fingerprint: string
  pageNumber: number
  language: OcrLanguage
  engine?: string
  modelVersion?: string
}): string {
  const language = resolveOcrLanguage(input.language)
  const engine = input.engine ?? OCR_ENGINE_ID
  const modelVersion = input.modelVersion ?? OCR_MODEL_VERSION
  return `ocr:${input.fingerprint}:${input.pageNumber}:${language}:${engine}:${modelVersion}`
}
