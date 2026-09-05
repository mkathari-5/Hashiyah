import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { recordMarkCreated } from '@/services/annotations/history'
import { pagesRepo } from '@/db/repos/documents'
import { AnnotationMarkupMenu, type AnnotationMenuState } from '@/features/pdf/AnnotationProperties'
import { applySelectionMarkup, createTrackedMark, deleteAnnotationMark } from '@/features/pdf/annotationActions'
import {
  DEFAULT_HIGHLIGHT_HEX,
  DEFAULT_HIGHLIGHT_OPACITY,
  DEFAULT_UNDERLINE_HEX,
  DEFAULT_UNDERLINE_THICKNESS,
  displayHighlightColor,
  highlightFill,
  underlineCssColor,
} from '@/services/annotations/appearance'
import {
  isPdfGlyphTarget,
  markupPointerDownIntent,
  markupPointerUpAction,
  pointerDistance,
  type MarkupIntent,
} from '@/features/pdf/pdfToolBehavior'
import { OcrTextLayer } from '@/features/pdf/OcrTextLayer'
import { normalizeForSearch } from '@/lib/arabic'
import { pageId } from '@/lib/id'
import { AnnotationEngine } from '@/services/annotations/AnnotationEngine'
import { captureSelection, offsetsToRects, type PageTextContext } from '@/services/annotations/selection'
import { clientRectToNormalized, clientToNormalized, horizontalLineFromDrag, underlineRectsForSelection, type PageRotation } from '@/services/pdf/pageCoords'
import { buildPageText } from '@/services/pdf/pageText'
import { pdfjs, type PDFDocumentProxy } from '@/services/pdf/pdfjs'
import { useStudyStore } from '@/state/useStudyStore'
import type { Annotation, NormalizedRect, PageRecord, TextSource } from '@/types'

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
  rotation?: PageRotation
  pdfPageWidth: number
  pdfPageHeight: number
}

interface RenderedHighlight {
  annotation: Annotation
  rects: NormalizedRect[]
  degraded: boolean
}

export function PdfPage({
  pdf,
  documentId,
  bookId,
  pageNumber,
  width,
  visible,
  aspect,
  registry,
  rotation = 0,
  pdfPageWidth,
  pdfPageHeight,
}: Props) {
  const pageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const ctxRef = useRef<PageTextContext | null>(null)
  const markupGesture = useRef<{
    kind: MarkupIntent
    pointerId: number
    start: { x: number; y: number }
  } | null>(null)
  const [textReady, setTextReady] = useState(false)
  const [height, setHeight] = useState(() => Math.round(width * aspect))
  const [useOcrOverlay, setUseOcrOverlay] = useState(false)
  const [draftRect, setDraftRect] = useState<NormalizedRect | null>(null)
  const [annotMenu, setAnnotMenu] = useState<AnnotationMenuState | null>(null)

  const setSelection = useStudyStore((s) => s.setSelection)
  const setActiveAnnotation = useStudyStore((s) => s.setActiveAnnotation)
  const requestReveal = useStudyStore((s) => s.requestReveal)
  const activeAnnotationId = useStudyStore((s) => s.activeAnnotationId)
  const jumpRequest = useStudyStore((s) => s.jumpRequest)
  const pdfTool = useStudyStore((s) => s.pdfTool)

  const pageRecord = useLiveQuery(
    () => (visible ? pagesRepo.get(documentId, pageNumber) : undefined),
    [documentId, pageNumber, visible],
  ) as (PageRecord & { ocrWords?: PageRecord['ocrWords'] }) | undefined

  useEffect(() => setHeight(Math.round(width * aspect)), [width, aspect])

  const publishCtx = useCallback(
    (ctx: PageTextContext | null) => {
      ctxRef.current = ctx
      registry.set(pageNumber, ctx)
      setTextReady(!!ctx)
    },
    [pageNumber, registry],
  )

  useEffect(() => {
    if (!visible || width <= 0) return
    let cancelled = false
    let renderTask: { cancel: () => void } | null = null
    let textLayer: InstanceType<typeof pdfjs.TextLayer> | null = null

    void (async () => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return

      const userRotation = (page.rotate + rotation) % 360
      const base = page.getViewport({ scale: 1, rotation: userRotation })
      const scale = width / base.width
      const viewport = page.getViewport({ scale, rotation: userRotation })
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
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

      const task = page.render({
        canvas,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      })
      renderTask = task
      task.promise.catch((error: unknown) => {
        if (!(error instanceof Error) || !/cancel/i.test(error.message)) {
          console.error(`[pdf] page ${pageNumber} failed to paint`, error)
        }
      })

      const content = await page.getTextContent()
      if (cancelled) return
      const items = content.items as { str?: string; hasEOL?: boolean }[]
      const { text, itemOffsets } = buildPageText(items)
      const hasEmbedded = text.trim().length > 0

      const stored = await pagesRepo.get(documentId, pageNumber)
      const preferOcr =
        !hasEmbedded &&
        stored?.textSource === 'ocr' &&
        !!stored.ocrWords?.length &&
        stored.hasTextLayer

      if (preferOcr) {
        textEl.replaceChildren()
        if (!cancelled) setUseOcrOverlay(true)
        return
      }

      setUseOcrOverlay(false)
      textEl.replaceChildren()
      textLayer = new pdfjs.TextLayer({ textContentSource: content, container: textEl, viewport })
      await textLayer.render()
      if (cancelled) return

      const end = document.createElement('div')
      end.className = 'endOfContent'
      textEl.appendChild(end)

      textLayer.textDivs.forEach((div, index) => {
        div.dataset.i = String(index)
      })

      publishCtx({
        pageNumber,
        pageEl,
        textLayerEl: textEl,
        pageText: text,
        itemOffsets,
        rotation: viewport.rotation,
      })

      const unrotated = page.getViewport({ scale: 1 })
      const next = {
        id: pageId(documentId, pageNumber),
        documentId,
        pageNumber,
        text,
        normalizedText: normalizeForSearch(text),
        itemOffsets,
        width: unrotated.width,
        height: unrotated.height,
        rotation: unrotated.rotation,
        hasTextLayer: hasEmbedded,
        textSource: (hasEmbedded
          ? 'embedded'
          : stored?.textSource === 'ocr'
            ? 'ocr'
            : 'none') satisfies TextSource as TextSource,
        indexedAt: Date.now(),
        ocrWords: hasEmbedded ? undefined : stored?.ocrWords,
        ocrLanguage: hasEmbedded ? undefined : stored?.ocrLanguage,
        ocrEngine: hasEmbedded ? undefined : stored?.ocrEngine,
        ocrModelVersion: hasEmbedded ? undefined : stored?.ocrModelVersion,
      } satisfies PageRecord
      if (!stored || (hasEmbedded && (!stored.hasTextLayer || stored.textSource !== 'embedded'))) {
        await pagesRepo.put(next)
      } else if (!stored.hasTextLayer && !hasEmbedded && stored.textSource !== 'ocr') {
        if (stored.textSource !== 'none') await pagesRepo.put({ ...stored, textSource: 'none' })
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
      publishCtx(null)
    }
  }, [pdf, pageNumber, width, visible, documentId, publishCtx, pageRecord?.textSource, pageRecord?.indexedAt, rotation])

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
        rects: live.length ? live : resolution.rects,
        degraded: resolution.confidence < 0.8,
      }
    })
  }, [resolved, textReady])

  const [pulseId, setPulseId] = useState<string | null>(null)
  useEffect(() => {
    if (!jumpRequest) return
    if (!highlights.some((h) => h.annotation.id === jumpRequest.annotationId)) return
    setPulseId(jumpRequest.annotationId)
    const timer = setTimeout(() => setPulseId(null), 1300)
    return () => clearTimeout(timer)
  }, [jumpRequest, highlights])

  const pageBox = () => {
    const el = pageRef.current
    if (!el) return null
    const box = el.getBoundingClientRect()
    return { left: box.left, top: box.top, width: box.width, height: box.height }
  }

  useEffect(() => {
    markupGesture.current = null
    setDraftRect(null)
    pageRef.current?.classList.remove('is-drawing-markup')
  }, [pdfTool])

  const commitDrawnMark = (kind: 'area' | 'line', start: { x: number; y: number }, end: { x: number; y: number }) => {
    const box = pageBox()
    if (!box) return
    if (kind === 'line') {
      const from = clientToNormalized(start, box, rotation)
      const to = clientToNormalized(end, box, rotation)
      const rect = horizontalLineFromDrag(from, to, DEFAULT_UNDERLINE_THICKNESS)
      if (rect.w < 0.012) return
      void createTrackedMark({
        bookId,
        documentId,
        pageNumber,
        kind: 'line',
        rect,
        pageRotation: rotation,
        pageWidth: pageRecord?.width ?? pdfPageWidth,
        pageHeight: pageRecord?.height ?? pdfPageHeight,
        style: { strokeColor: DEFAULT_UNDERLINE_HEX, color: DEFAULT_UNDERLINE_HEX, strokeWidth: 1 },
      }).then((created) => recordMarkCreated(created))
      return
    }
    const rect = clientRectToNormalized(start, end, box, rotation, { clamp: true, minSize: 0.012 })
    if (!rect) return
    void createTrackedMark({
      bookId,
      documentId,
      pageNumber,
      kind: 'area',
      rect,
      pageRotation: rotation,
      pageWidth: pageRecord?.width ?? pdfPageWidth,
      pageHeight: pageRecord?.height ?? pdfPageHeight,
      style: { fillColor: DEFAULT_HIGHLIGHT_HEX, fillOpacity: DEFAULT_HIGHLIGHT_OPACITY },
    }).then((created) => recordMarkCreated(created))
  }

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    if (event.currentTarget.closest('.pdf-canvas.is-panning')) return
    if (pdfTool === 'text' || pdfTool === 'pan') return

    const study = useStudyStore.getState()
    if (study.selectedMarkId || study.editingMarkId) {
      study.setSelectedMarkId(null)
      study.setEditingMarkId(null)
    }

    setDraftRect(null)

    const intent = markupPointerDownIntent(pdfTool, isPdfGlyphTarget(event.target))
    if (!intent) return
    markupGesture.current = { kind: intent, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY } }
    if (intent === 'select-text') return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.classList.add('is-drawing-markup')
    study.setAnnotationGesture(true)
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    const gesture = markupGesture.current
    if (!gesture || gesture.kind === 'select-text') return
    const box = pageBox()
    if (!box) return
      if (gesture.kind === 'draw-line') {
      const start = clientToNormalized(gesture.start, box, rotation)
      const end = clientToNormalized({ x: event.clientX, y: event.clientY }, box, rotation)
      setDraftRect(horizontalLineFromDrag(start, end, DEFAULT_UNDERLINE_THICKNESS))
      return
    }
    const rect = clientRectToNormalized(gesture.start, { x: event.clientX, y: event.clientY }, box, rotation, {
      clamp: true,
      minSize: 0.008,
    })
    setDraftRect(rect)
  }

  const handlePointerUp = (event: React.PointerEvent) => {
      const gesture = markupGesture.current
      markupGesture.current = null
      setDraftRect(null)
      pageRef.current?.classList.remove('is-drawing-markup')
      useStudyStore.getState().setAnnotationGesture(false)

      const ctx = ctxRef.current
      const selection = window.getSelection()
      const box = pageBox()

      if (pdfTool === 'text' || pdfTool === 'pan') return

      if (pdfTool === 'erase') {
        if (!box) return
        const x = (event.clientX - box.left) / box.width
        const y = (event.clientY - box.top) / box.height
        const hit = highlights.find((h) =>
          h.rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h),
        )
        if (hit) void deleteAnnotationMark(hit.annotation.id)
        return
      }

      if (gesture) {
        const hasText = Boolean(selection && !selection.isCollapsed && ctx)
        const action = markupPointerUpAction({
          intent: gesture.kind,
          hasTextSelection: hasText,
          dragDistance: pointerDistance(gesture.start, { x: event.clientX, y: event.clientY }),
        })
        if (action === 'apply-text' && selection && ctx) {
          const capture = captureSelection(selection, ctx)
          if (capture) {
            void applySelectionMarkup(pdfTool === 'underline' ? 'underline' : 'highlight', {
              capture,
              documentId,
              bookId,
              menuLeft: event.clientX,
              menuTop: event.clientY,
            })
          }
          return
        }
        if (action === 'commit-draw') {
          commitDrawnMark(gesture.kind === 'draw-line' ? 'line' : 'area', gesture.start, {
            x: event.clientX,
            y: event.clientY,
          })
          return
        }
        return
      }

      if (selection && !selection.isCollapsed && ctx && pdfTool === 'select') {
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

      if (!box) return
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
    }

  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    const onDown = () => el.classList.add('selecting')
    const onUp = () => el.classList.remove('selecting')
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const ocrWords = pageRecord?.ocrWords ?? []
  const showOcr = useOcrOverlay && ocrWords.length > 0 && pageRecord?.textSource === 'ocr'
  const toolClass = `is-tool-${pdfTool}`

  return (
    <div
      ref={pageRef}
      className={`pdf-page mx-auto ${toolClass}`.trim()}
      style={{ width, height }}
      data-page={pageNumber}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={(event) => {
        const box = pageBox()
        if (!box) return
        const x = (event.clientX - box.left) / box.width
        const y = (event.clientY - box.top) / box.height
        const hit = highlights.find((h) => {
          const rects = h.annotation.kind === 'underline' ? underlineRectsForSelection(h.rects) : h.rects
          return rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
        })
        if (!hit || (hit.annotation.kind !== 'highlight' && hit.annotation.kind !== 'underline')) return
        event.preventDefault()
        setActiveAnnotation(hit.annotation.id)
        setAnnotMenu({
          x: event.clientX,
          y: event.clientY,
          annotationId: hit.annotation.id,
          kind: hit.annotation.kind,
        })
      }}
    >
      <canvas ref={canvasRef} aria-label={`Page ${pageNumber}`} />

      <div className="highlight-layer">
        {highlights.map(({ annotation, rects, degraded }) =>
          (annotation.kind === 'underline' ? underlineRectsForSelection(rects) : rects).map((r, i) => {
            const paint = displayHighlightColor(annotation.kind, annotation.color)
            const isUnderline = annotation.kind === 'underline'
            const isHighlight = annotation.kind === 'highlight'
            return (
              <div
                key={`${annotation.id}:${i}`}
                className={[
                  annotation.kind === 'capture' ? 'hl-capture-region' : isUnderline ? 'hl-underline' : 'hl',
                  annotation.kind === 'capture' || isUnderline || isHighlight ? '' : `hl-${annotation.color}`,
                  isUnderline ? `hl-underline-${paint}` : '',
                  isHighlight ? `hl-${paint}` : '',
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
                  ...(isHighlight
                    ? { background: highlightFill(paint, annotation.opacity ?? DEFAULT_HIGHLIGHT_OPACITY) }
                    : {}),
                  ...(isUnderline ? { background: underlineCssColor(annotation.color) } : {}),
                }}
              />
            )
          }),
        )}
        {draftRect && (
          <div
            className={pdfTool === 'underline' ? 'hl-underline hl-underline-ink' : 'hl hl-yellow'}
            style={{
              left: `${draftRect.x * 100}%`,
              top: `${draftRect.y * 100}%`,
              width: `${draftRect.w * 100}%`,
              height: `${draftRect.h * 100}%`,
              ...(pdfTool === 'underline'
                ? { background: DEFAULT_UNDERLINE_HEX }
                : { background: highlightFill('yellow') }),
            }}
          />
        )}
      </div>

      <div ref={textLayerRef} className="textLayer" hidden={showOcr} />

      {showOcr && (
        <OcrTextLayer
          words={ocrWords}
          pageText={pageRecord?.text ?? ''}
          itemOffsets={pageRecord?.itemOffsets ?? []}
          pageNumber={pageNumber}
          pageEl={pageRef.current}
          onReady={publishCtx}
        />
      )}

      {showOcr && (
        <span className="ocr-source-label">Machine-recognised text — check against the page</span>
      )}

      {!visible && (
        <div className="text-ink-faint absolute inset-0 flex items-center justify-center text-xs">
          {pageNumber}
        </div>
      )}

      {annotMenu && (
        <AnnotationMarkupMenu
          menu={annotMenu}
          color={
            highlights.find((h) => h.annotation.id === annotMenu.annotationId)?.annotation.color ??
            (annotMenu.kind === 'underline' ? 'ink' : 'yellow')
          }
          opacity={highlights.find((h) => h.annotation.id === annotMenu.annotationId)?.annotation.opacity}
          onClose={() => setAnnotMenu(null)}
        />
      )}
    </div>
  )
}
