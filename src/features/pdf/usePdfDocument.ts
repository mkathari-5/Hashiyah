import { useEffect, useState } from 'react'
import { documentsRepo } from '@/db/repos/documents'
import { loadPdf, type PDFDocumentProxy } from '@/services/pdf/pdfjs'

export interface PdfHandle {
  pdf: PDFDocumentProxy
  pageCount: number
  /** height / width of page 1, used to size not-yet-rendered page slots. */
  aspect: number
  baseWidth: number
}

interface State {
  handle: PdfHandle | null
  loading: boolean
  error: string | null
}

/**
 * Opens a stored document. One pdf.js document instance per open book — pages
 * are fetched from it lazily by the viewer.
 */
export function usePdfDocument(documentId: string | null): State {
  const [state, setState] = useState<State>({ handle: null, loading: false, error: null })

  useEffect(() => {
    if (!documentId) {
      setState({ handle: null, loading: false, error: null })
      return
    }
    let cancelled = false
    let dispose: (() => Promise<void>) | null = null
    setState({ handle: null, loading: true, error: null })

    void (async () => {
      try {
        const blob = await documentsRepo.blob(documentId)
        if (!blob) throw new Error('The file for this book is missing from local storage.')
        const { pdf, pageCount, destroy } = await loadPdf(await blob.arrayBuffer())
        dispose = destroy
        const first = await pdf.getPage(1)
        const viewport = first.getViewport({ scale: 1 })
        first.cleanup()
        if (cancelled) {
          void destroy()
          return
        }
        setState({
          handle: { pdf, pageCount, aspect: viewport.height / viewport.width, baseWidth: viewport.width },
          loading: false,
          error: null,
        })
      } catch (error) {
        if (cancelled) return
        setState({
          handle: null,
          loading: false,
          error: error instanceof Error ? error.message : 'This PDF could not be opened.',
        })
      }
    })()

    return () => {
      cancelled = true
      void dispose?.()
    }
  }, [documentId])

  return state
}
