import type { OcrLanguage, OcrLine, OcrWordBox } from '@/types'

export interface OcrRecognizeInput {
  canvas: HTMLCanvasElement
  pageNumber: number
  language: OcrLanguage
}

export interface OcrRecognizeResult {
  text: string
  words: OcrWordBox[]
  lines: OcrLine[]
  confidence: number
  pageNumber: number
  language: OcrLanguage
  direction: 'rtl' | 'ltr' | 'mixed'
  engine: string
  modelVersion: string
}

export interface OcrProvider {
  readonly id: string
  readonly modelVersion: string
  recognize(input: OcrRecognizeInput, signal?: AbortSignal): Promise<OcrRecognizeResult>
  terminate(): Promise<void>
}
