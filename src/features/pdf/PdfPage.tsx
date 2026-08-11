import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { pagesRepo } from '@/db/repos/documents'
import { normalizeForSearch } from '@/lib/arabic'
import { pageId } from '@/lib/id'
import { AnnotationEngine } from '@/services/annotations/AnnotationEngine'
import { captureSelection, offsetsToRects, type PageTextContext } from '@/services/annotations/selection'
import { buildPageText } from '@/services/pdf/pageText'
import { pdfjs, type PDFDocumentProxy } from '@/services/pdf/pdfjs'
import { useStudyStore } from '@/state/useStudyStore'
import type { Annotation, NormalizedRect } from '@/types'

export interface PageContextRegistry {
  set: (pageNumber: number, ctx: PageTextContext | null) => void
  get: (pageNumber: number) => PageTextContext | null
}

interface Props {
  pdf: PDFDocumentProxy
  documentId: string
  bookId: string
  pageNumber: number
  /** CSS pixel width of the page box. */
  width: number
  /** Only mounted pages near the viewport actually render. */
  visible: boolean
  aspect: number
  registry: PageContextRegistry
}

interface RenderedHighlight {
  annotation: Annotation
  rects: NormalizedRect[]
  degraded: boolean
}

export function PdfPage({ pdf, documentId, bookId, pageNumber, width, visible, aspect, registry }: Props) {
  const pageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const ctxRef = useRef<PageTextContext | null>(null)
  const [textReady, setTextReady] = useState(false)
  const [height, setHeight] = useState(() => Math.round(width * aspect))

  const setSelection = useStudyStore((s) => s.setSelection)
  const setActiveAnnotation = useStudyStore((s) => s.setActiveAnnotation)
  const requestReveal = useStudyStore((s) => s.requestReveal)
  const activeAnnotationId = useStudyStore((s) => s.activeAnnotationId)
  const jumpRequest = useStudyStore((s) => s.jumpRequest)

  useEffect(() => setHeight(Math.round(width * aspect)), [width, aspect])

  // ── Render canvas + text layer ────────────────────────────────────────────
  useEffect(() => {
    if (!visible || width <= 0) return
    let cancelled = false
    let renderTask: { cancel: () => void } | null = null
    let textLayer: InstanceType<typeof pdfjs.TextLayer> | null = null

    void (async () => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return

      const base = page.getViewport({ scale: 1 })
      const scale = width / base.width
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      const pageEl = pageRef.current
      const textEl = textLayerRef.current
      if (!canvas || !pageEl || !textEl) return

      setHeight(Math.round(viewport.height))
      pageEl.style.setProperty('--total-scale-factor', String(scale))
      pageEl.style.setProperty('--scale-factor', String(scale))

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)

      // Painting is started but deliberately *not* awaited. The text layer is
      // what makes a page selectable, and it must not queue behind rasterising
      // a 300 dpi scan — nor be lost entirely if that raster fails. Two
      // independent pipelines onto the same page box.
      const task = page.render({
        canvas,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      })
      renderTask = task
      task.promise.catch((error: unknown) => {
        // A cancelled render is normal: fast scrolling, zoom change, unmount.
        if (!(error instanceof Error) || !/cancel/i.test(error.message)) {
          console.error(`[pdf] page ${pageNumber} failed to paint`, error)
        }
      })

      const content = await page.getTextContent()
      if (cancelled) return
      const items = content.items as { str?: string; hasEOL?: boolean }[]
      const { text, itemOffsets } = buildPageText(items)

      textEl.replaceChildren()
      textLayer = new pdfjs.TextLayer({ textContentSource: content, container: textEl, viewport })
      await textLayer.render()
      if (cancelled) return

      // The tag that makes DOM selection convertible to canonical offsets.
      textLayer.textDivs.forEach((div, index) => {
        div.dataset.i = String(index)
      })

      const ctx: PageTextContext = {
        pageNumber,
        pageEl,
        textLayerEl: textEl,
        pageText: text,
        itemOffsets,
        rotation: viewport.rotation,
      }
      ctxRef.current = ctx
      registry.set(pageNumber, ctx)
      setTextReady(true)

      // Index on sight. Background indexing may not have reached this page yet,
      // and Extract & Explain must work the instant a page is readable.
      if (!(await pagesRepo.get(documentId, pageNumber))) {
        await pagesRepo.put({
          id: pageId(documentId, pageNumber),
          documentId,
          pageNumber,
          text,
          normalizedText: normalizeForSearch(text),
          itemOffsets,
          width: base.width,
          height: base.height,
          rotation: base.rotation,
          hasTextLayer: text.trim().length > 0,
          textSource: text.trim().length > 0 ? 'embedded' : 'none',
          indexedAt: Date.now(),
        })
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
      registry.set(pageNumber, null)
      ctxRef.current = null
      setTextReady(false)
    }
  }, [pdf, pageNumber, width, visible, documentId, registry])

  // ── Annotations on this page ──────────────────────────────────────────────
  const resolved = useLiveQuery(
    () => (visible ? AnnotationEngine.resolveForPage(documentId, pageNumber) : Promise.resolve([])),
    [documentId, pageNumber, visible],
    [],
  )

  const highlights = useMemo<RenderedHighlight[]>(() => {
    if (!resolved?.length) return []
    const ctx = ctxRef.current
    return resolved.map(({ annotation, resolution }) => {
      const live =
        ctx && textReady && resolution.strategy !== 'geometric' && resolution.strategy !== 'unresolved'
          ? offsetsToRects(ctx, resolution.startOffset, resolution.endOffset)
          : []
      return {
        annotation,
        // Live rects are always preferred: they are correct for the current
        // zoom. Stored rects are the fallback for pages with no text layer.
        rects: live.length ? live : resolution.rects,
        degraded: resolution.confidence < 0.8,
      }
    })
  }, [resolved, textReady])

  // ── Pulse when a note jumps to its source ─────────────────────────────────
  const [pulseId, setPulseId] = useState<string | null>(null)
  useEffect(() => {
    if (!jumpRequest) return
    if (!highlights.some((h) => h.annotation.id === jumpRequest.annotationId)) return
    setPulseId(jumpRequest.annotationId)
    const timer = setTimeout(() => setPulseId(null), 1300)
    return () => clearTimeout(timer)
  }, [jumpRequest, highlights])

  // ── Selection + highlight hit-testing ─────────────────────────────────────
  const handlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      const ctx = ctxRef.current
      if (!ctx) return
      const selection = window.getSelection()

      if (selection && !selection.isCollapsed) {
        const capture = captureSelection(selection, ctx)
        if (capture) {
          const rects = selection.getRangeAt(0).getClientRects()
          const last = rects[rects.length - 1]
          setSelection({
            capture,
            documentId,
            bookId,
            menuLeft: last ? last.left + last.width / 2 : event.clientX,
            menuTop: last ? last.top : event.clientY,
          })
          return
        }
      }

      // A plain click: did it land on a highlight? (§9 — clicking a highlighted
      // passage reveals the notes written about it.)
      const pageEl = pageRef.current
      if (!pageEl) return
      const box = pageEl.getBoundingClientRect()
      const x = (event.clientX - box.left) / box.width
      const y = (event.clientY - box.top) / box.height
      const hit = highlights.find((h) =>
        h.rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h),
      )
      setSelection(null)
      if (hit) {
        setActiveAnnotation(hit.annotation.id)
        void AnnotationEngine.notesFor(hit.annotation.id).then((notes) => {
          if (notes[0]) requestReveal(notes[0].id, hit.annotation.id)
        })
      } else {
        setActiveAnnotation(null)
      }
    },
    [documentId, bookId, highlights, setSelection, setActiveAnnotation, requestReveal],
  )

  return (
    <div
      ref={pageRef}
      className="pdf-page mx-auto"
      style={{ width, height }}
      data-page={pageNumber}
      onPointerUp={handlePointerUp}
    >
      <canvas ref={canvasRef} aria-label={`Page ${pageNumber}`} />

      <div className="highlight-layer">
        {highlights.map(({ annotation, rects, degraded }) =>
          rects.map((r, i) => (
            <div
              key={`${annotation.id}:${i}`}
              className={[
                // A snipped region is outlined, not filled: it marks where a
                // screenshot came from rather than marking up the text (§D12).
                annotation.kind === 'capture' ? 'hl-capture-region' : 'hl',
                annotation.kind === 'capture' ? '' : `hl-${annotation.color}`,
                activeAnnotationId === annotation.id ? 'hl-active' : '',
                pulseId === annotation.id ? 'hl-pulse' : '',
                degraded ? 'opacity-60' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
              }}
            />
          )),
        )}
      </div>

      <div ref={textLayerRef} className="textLayer" />

      {!visible && (
        <div className="text-ink-faint absolute inset-0 flex items-center justify-center text-xs">
          {pageNumber}
        </div>
      )}
    </div>
  )
}
