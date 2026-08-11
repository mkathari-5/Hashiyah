import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/**
 * pdf.js adapter.
 *
 * Everything pdf.js needs is served from our own `/pdfjs` directory (copied out
 * of the package by `scripts/copy-pdfjs-assets.mjs`) rather than a CDN. Reading
 * a book must not make a network request — including for a font it happens to
 * need on page 40.
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`

export interface LoadedDocument {
  pdf: PDFDocumentProxy
  /** pdf.js's own fingerprint — useful diagnostics, not our identity key. */
  pdfFingerprint: string
  pageCount: number
  /**
   * Tears down the document *and its worker*. In pdf.js 6 that lives on the
   * loading task, not the document proxy, so it is surfaced here rather than
   * leaking the task to every caller.
   */
  destroy: () => Promise<void>
}

export async function loadPdf(data: ArrayBuffer): Promise<LoadedDocument> {
  const task = pdfjs.getDocument({
    // pdf.js takes ownership of the buffer, so hand it a copy — the caller may
    // still need the original bytes for hashing or for storing the blob.
    data: new Uint8Array(data.slice(0)),
    cMapUrl: `${ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
    wasmUrl: `${ASSET_BASE}wasm/`,
    iccUrl: `${ASSET_BASE}iccs/`,
    // Arabic PDFs frequently embed subset fonts; letting pdf.js install them as
    // real @font-face rules is what makes the shaping correct.
    disableFontFace: false,
    useSystemFonts: false,
  })
  const pdf = await task.promise
  return {
    pdf,
    pdfFingerprint: pdf.fingerprints?.[0] ?? '',
    pageCount: pdf.numPages,
    destroy: () => task.destroy(),
  }
}

export { pdfjs }
export type { PDFDocumentProxy }
export type PDFPageProxy = Awaited<ReturnType<PDFDocumentProxy['getPage']>>
