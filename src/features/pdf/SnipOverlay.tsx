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

export function SnipOverlay({ pdf, scrollRef }: Props) {
  const snipMode = useStudyStore((s) => s.snipMode)
  const setSnipMode = useStudyStore((s) => s.setSnipMode)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [busy, setBusy] = useState(false)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag

  const cancel = useCallback(() => {
    setDrag(null)
    setSnipMode(null)
  }, [setSnipMode])

  useEffect(() => {
    if (!snipMode) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [snipMode, cancel])

  if (!snipMode) return null

  const onPointerDown = (event: React.PointerEvent) => {
    if (busy) return
    // Find the page under the pointer by hit-testing, since the overlay itself
    // sits above every page.
    const container = scrollRef.current
    if (!container) return
    const el = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((node) => node instanceof HTMLElement && node.dataset.page) as HTMLElement | undefined
    if (!el) return

    const pageNumber = Number(el.dataset.page)
    const pageBox = el.getBoundingClientRect()
    const point = { x: event.clientX, y: event.clientY }
    setDrag({ pageNumber, pageBox, start: point, current: point })
    ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragRef.current) return
    setDrag({ ...dragRef.current, current: { x: event.clientX, y: event.clientY } })
  }

  const onPointerUp = async () => {
    const current = dragRef.current
    setDrag(null)
    if (!current) return

    const rect = dragToNormalizedRect(current.start, current.current, current.pageBox)
    if (!rect) {
      cancel()
      return
    }

    setBusy(true)
    try {
      await captureRegionToNotes(pdf, current.pageNumber, rect, {
        withExplanation: snipMode === 'explain',
      })
    } finally {
      setBusy(false)
      setSnipMode(null)
    }
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
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="application"
      aria-label="Drag to capture a region of the page"
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
            Drag to capture{snipMode === 'explain' ? ' and explain' : ''}
            <span className="snip-hint-key">Esc</span>
          </>
        )}
      </div>
    </div>
  )
}
