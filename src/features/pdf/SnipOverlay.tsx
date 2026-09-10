import { useCallback, useEffect, useRef, useState } from 'react'
import { captureRegionToNotes } from '@/services/notes/extract'
import { dragToNormalizedRect } from '@/services/pdf/capture'
import type { PDFDocumentProxy } from '@/services/pdf/pdfjs'
import { useStudyStore } from '@/state/useStudyStore'

/**
 * Region capture (§D9).
 *
 * Covers the reader while active, turns the cursor into a crosshair, and lets
 * the reader drag a rectangle over any page. On release the region is captured
 * and inserted, and capture mode ends immediately — no save dialog, no
 * download, no round trip through the operating system.
 *
 * The rectangle is resolved against whichever page element it started on, so a
 * drag is always expressed in that page's own coordinate space and stays
 * correct at any zoom.
 */

interface Props {
  pdf: PDFDocumentProxy
  scrollRef: React.RefObject<HTMLElement | null>
}

interface Drag {
  pageNumber: number
  pageBox: DOMRect
  start: { x: number; y: number }
  current: { x: number; y: number }
}

function pageUnderPoint(x: number, y: number): HTMLElement | undefined {
  return document
    .elementsFromPoint(x, y)
    .find((node) => node instanceof HTMLElement && node.dataset.page) as HTMLElement | undefined
}

export function SnipOverlay({ pdf, scrollRef }: Props) {
  const snipMode = useStudyStore((s) => s.snipMode)
  const setSnipMode = useStudyStore((s) => s.setSnipMode)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [busy, setBusy] = useState(false)
  const dragRef = useRef<Drag | null>(null)
  const busyRef = useRef(false)
  busyRef.current = busy

  const cancel = useCallback(() => {
    dragRef.current = null
    setDrag(null)
    setSnipMode(null)
  }, [setSnipMode])

  const commitDrag = useCallback(async () => {
    const current = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!current || busyRef.current) return

    const mode = useStudyStore.getState().snipMode
    const rect = dragToNormalizedRect(current.start, current.current, current.pageBox)
    if (!rect && mode !== 'link') {
      cancel()
      return
    }

    setBusy(true)
    busyRef.current = true
    try {
      if (mode === 'link') {
        const study = useStudyStore.getState()
        if (!study.bookId || !study.documentId) {
          cancel()
          return
        }
        const nx = (current.start.x - current.pageBox.left) / current.pageBox.width
        const ny = (current.start.y - current.pageBox.top) / current.pageBox.height
        const kind = rect ? 'region' : 'point'
        const rects = rect ? [rect] : [{ x: nx, y: ny, w: 0.004, h: 0.004 }]
        study.setLinkDraft({
          capture: {
            pageNumber: current.pageNumber,
            text: '',
            startOffset: 0,
            endOffset: 0,
            itemStart: 0,
            itemEnd: 0,
            textBefore: '',
            textAfter: '',
            occurrenceIndex: 0,
            rects,
            pageWidth: current.pageBox.width,
            pageHeight: current.pageBox.height,
            pageRotation: 0,
          },
          documentId: study.documentId,
          bookId: study.bookId,
          menuLeft: current.current.x,
          menuTop: current.current.y,
          textSource: 'none',
          anchorKind: kind,
        })
        return
      }
      if (!rect) {
        cancel()
        return
      }
      await captureRegionToNotes(pdf, current.pageNumber, rect, {
        withExplanation: mode === 'explain',
      })
    } finally {
      busyRef.current = false
      setBusy(false)
      setSnipMode(null)
    }
  }, [cancel, pdf, setSnipMode])

  useEffect(() => {
    if (!snipMode) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      }
    }
    const onMove = (event: PointerEvent) => {
      if (!dragRef.current) return
      const next = { ...dragRef.current, current: { x: event.clientX, y: event.clientY } }
      dragRef.current = next
      setDrag(next)
    }
    const onUp = () => {
      if (!dragRef.current) return
      void commitDrag()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [snipMode, cancel, commitDrag])

  if (!snipMode) return null

  const onPointerDown = (event: React.PointerEvent) => {
    if (busyRef.current) return
    const container = scrollRef.current
    if (!container) return
    const el = pageUnderPoint(event.clientX, event.clientY)
    if (!el) return

    const pageNumber = Number(el.dataset.page)
    const pageBox = el.getBoundingClientRect()
    const point = { x: event.clientX, y: event.clientY }
    const next = { pageNumber, pageBox, start: point, current: point }
    dragRef.current = next
    setDrag(next)
    event.preventDefault()
  }

  const box = drag
    ? {
        left: Math.min(drag.start.x, drag.current.x),
        top: Math.min(drag.start.y, drag.current.y),
        width: Math.abs(drag.current.x - drag.start.x),
        height: Math.abs(drag.current.y - drag.start.y),
      }
    : null

  return (
    <div
      className="snip-overlay"
      onPointerDown={onPointerDown}
      role="application"
      aria-label={snipMode === 'link' ? 'Drag to link a region of the page' : 'Drag to capture a region of the page'}
    >
      {box && (
        <div
          className="snip-rect"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        />
      )}

      <div className="snip-hint">
        {busy ? (
          'Capturing…'
        ) : (
          <>
            Drag to {snipMode === 'link' ? 'link a region' : `capture${snipMode === 'explain' ? ' and explain' : ''}`}
            <span className="snip-hint-key">Esc</span>
          </>
        )}
      </div>
    </div>
  )
}
