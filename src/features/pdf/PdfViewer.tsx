import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { booksRepo } from '@/db/repos/library'
import { anchorsRepo } from '@/db/repos/annotations'
import { pagesRepo } from '@/db/repos/documents'
import { PdfPage, type PageContextRegistry } from '@/features/pdf/PdfPage'
import { SelectionMenu } from '@/features/pdf/SelectionMenu'
import { SnipOverlay } from '@/features/pdf/SnipOverlay'
import { usePdfDocument } from '@/features/pdf/usePdfDocument'
import { isImageOnlyPage, ocrPdfPage } from '@/services/ocr/OcrService'
import { useStudyStore } from '@/state/useStudyStore'
import type { PageTextContext } from '@/services/annotations/selection'
import { Icon } from '@/features/shell/Icon'
import { displayTitle, secondaryTitle } from '@/lib/bookTitle'
import type { PDFDocumentProxy } from '@/services/pdf/pdfjs'

const GAP = 20
const HORIZONTAL_PADDING = 48
const OVERSCAN = 1
const MIN_ZOOM = 0.4
const MAX_ZOOM = 4

export function PdfViewer() {
  const bookId = useStudyStore((s) => s.bookId)
  const documentId = useStudyStore((s) => s.documentId)
  const currentPage = useStudyStore((s) => s.currentPage)
  const zoom = useStudyStore((s) => s.zoom)
  const setZoom = useStudyStore((s) => s.setZoom)
  const setPage = useStudyStore((s) => s.setPage)
  const setPageCount = useStudyStore((s) => s.setPageCount)
  const restoredScrollRatio = useStudyStore((s) => s.restoredScrollRatio)
  const clearRestoredScroll = useStudyStore((s) => s.clearRestoredScroll)
  const persistPosition = useStudyStore((s) => s.persistPosition)
  const jumpRequest = useStudyStore((s) => s.jumpRequest)
  const setSelection = useStudyStore((s) => s.setSelection)
  const snipMode = useStudyStore((s) => s.snipMode)
  const setSnipMode = useStudyStore((s) => s.setSnipMode)

  const { handle, loading, error } = usePdfDocument(documentId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  const book = useLiveQuery(() => (bookId ? booksRepo.get(bookId) : undefined), [bookId])

  // A registry rather than state: page contexts are imperative handles that
  // must not trigger re-renders when they appear.
  const contexts = useRef(new Map<number, PageTextContext>())
  const registry = useMemo<PageContextRegistry>(
    () => ({
      set: (pageNumber, ctx) => {
        if (ctx) contexts.current.set(pageNumber, ctx)
        else contexts.current.delete(pageNumber)
      },
      get: (pageNumber) => contexts.current.get(pageNumber) ?? null,
    }),
    [],
  )

  useEffect(() => {
    if (handle) setPageCount(handle.pageCount)
  }, [handle, setPageCount])

  // ── Measure ───────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width)
      setViewportHeight(entry.contentRect.height)
    })
    observer.observe(el)
    setContainerWidth(el.clientWidth)
    setViewportHeight(el.clientHeight)
    return () => observer.disconnect()
  }, [handle])

  const fitWidth = Math.max(120, containerWidth - HORIZONTAL_PADDING)
  const pageWidth = Math.round(fitWidth * zoom)
  const pageHeight = handle ? Math.round(pageWidth * handle.aspect) : 0
  const slot = pageHeight + GAP
  const pageCount = handle?.pageCount ?? 0

  // ── Windowing ─────────────────────────────────────────────────────────────
  const [first, last] = useMemo(() => {
    if (!slot || !pageCount) return [1, 0] as const
    const f = Math.max(1, Math.floor(scrollTop / slot) + 1 - OVERSCAN)
    const l = Math.min(pageCount, Math.ceil((scrollTop + viewportHeight) / slot) + OVERSCAN)
    return [f, l] as const
  }, [scrollTop, viewportHeight, slot, pageCount])

  const visiblePages = useMemo(() => {
    const out: number[] = []
    for (let n = first; n <= last; n++) out.push(n)
    return out
  }, [first, last])

  // ── Scroll tracking, current page and position persistence ────────────────
  const persistTimer = useRef<number | undefined>(undefined)
  /** Where we are, in page-relative terms — survives any change of page size. */
  const positionRef = useRef({ page: 1, ratio: 0 })
  const restoredFor = useRef<string | null>(null)
  const lastSlot = useRef(0)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || !slot) return
    setScrollTop(el.scrollTop)

    // The page occupying the reading line (a third down the viewport).
    const readingLine = el.scrollTop + el.clientHeight * 0.33
    const page = Math.min(pageCount, Math.max(1, Math.floor(readingLine / slot) + 1))
    setPage(page)

    const within = Math.min(1, Math.max(0, (el.scrollTop - (page - 1) * slot) / Math.max(1, pageHeight)))
    positionRef.current = { page, ratio: within }

    window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => persistPosition(within), 400)
  }, [slot, pageCount, pageHeight, setPage, persistPosition])

  useEffect(() => () => window.clearTimeout(persistTimer.current), [])

  // ── Restore reading position (§52) ────────────────────────────────────────
  useEffect(() => {
    // `containerWidth === 0` means the ResizeObserver has not reported yet, so
    // `slot` is still built on the fallback minimum width. Restoring against
    // that lands the reader hundreds of pixels from where they left off, which
    // is worse than not restoring at all.
    if (!handle || !slot || !documentId || containerWidth === 0) return
    if (restoredScrollRatio === null || restoredFor.current === documentId) return
    const el = scrollRef.current
    if (!el) return

    restoredFor.current = documentId
    lastSlot.current = slot
    positionRef.current = { page: currentPage, ratio: restoredScrollRatio }
    el.scrollTop = (currentPage - 1) * slot + restoredScrollRatio * pageHeight
    setScrollTop(el.scrollTop)
    clearRestoredScroll()
  }, [
    handle,
    slot,
    pageHeight,
    containerWidth,
    currentPage,
    restoredScrollRatio,
    documentId,
    clearRestoredScroll,
  ])

  useEffect(() => {
    restoredFor.current = null
    lastSlot.current = 0
  }, [documentId])

  // Zooming or resizing the panel must not lose your place on the page.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !slot || restoredFor.current !== documentId) return
    if (lastSlot.current === 0 || lastSlot.current === slot) {
      lastSlot.current = slot
      return
    }
    lastSlot.current = slot
    const { page, ratio } = positionRef.current
    el.scrollTop = (page - 1) * slot + ratio * pageHeight
    setScrollTop(el.scrollTop)
  }, [slot, pageHeight, documentId])

  // ── Programmatic navigation ───────────────────────────────────────────────
  const scrollToPage = useCallback(
    (page: number, withinRatio = 0) => {
      const el = scrollRef.current
      if (!el || !slot) return
      el.scrollTo({
        top: Math.max(0, (page - 1) * slot + withinRatio * pageHeight - el.clientHeight * 0.28),
        behavior: 'smooth',
      })
    },
    [slot, pageHeight],
  )

  // ── Jump to source (§9) ───────────────────────────────────────────────────
  useEffect(() => {
    if (!jumpRequest || !slot) return
    void (async () => {
      const anchor = await anchorsRepo.forAnnotation(jumpRequest.annotationId)
      if (!anchor) return
      const y = anchor.rects[0]?.y ?? 0
      setPage(anchor.pageNumber)
      scrollToPage(anchor.pageNumber, y)
    })()
  }, [jumpRequest, slot, scrollToPage, setPage])

  // ── Keyboard navigation ───────────────────────────────────────────────────
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const el = scrollRef.current
      if (!el) return
      if (event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) {
        event.preventDefault()
        el.scrollBy({ top: el.clientHeight * 0.9, behavior: 'smooth' })
      } else if (event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) {
        event.preventDefault()
        el.scrollBy({ top: -el.clientHeight * 0.9, behavior: 'smooth' })
      } else if (event.key === 'Home') {
        event.preventDefault()
        el.scrollTo({ top: 0, behavior: 'smooth' })
      } else if (event.key === 'End') {
        event.preventDefault()
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      }
    },
    [],
  )

  if (!bookId) return <EmptyReader />
  if (loading) return <ReaderMessage>Opening…</ReaderMessage>
  if (error) return <ReaderMessage tone="error">{error}</ReaderMessage>
  if (!handle) return <ReaderMessage>This book has no document attached.</ReaderMessage>

  return (
    <div className="relative flex h-full min-w-0 flex-col">
      <Toolbar
        title={displayTitle(book)}
        arabicTitle={secondaryTitle(book) ?? undefined}
        page={currentPage}
        pageCount={pageCount}
        zoom={zoom}
        onPage={(p) => {
          setPage(p)
          scrollToPage(p)
        }}
        onZoom={(z) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)))}
        onFitWidth={() => setZoom(1)}
        onSnip={(mode) => setSnipMode(mode)}
        snipActive={snipMode !== null}
      />

      {documentId && (
        <OcrBanner pdf={handle.pdf} documentId={documentId} pageNumber={currentPage} />
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        tabIndex={0}
        // §50 — the page floats on a slightly deeper surface than the chrome,
        // which is what gives the book physical presence.
        className="pdf-canvas relative flex-1 overflow-y-auto overflow-x-hidden outline-none"
        onPointerDown={() => setSelection(null)}
      >
        <div style={{ height: pageCount * slot + GAP, position: 'relative' }}>
          {visiblePages.map((n) => (
            <div
              key={n}
              style={{ position: 'absolute', top: (n - 1) * slot + GAP, left: 0, right: 0 }}
            >
              <PdfPage
                pdf={handle.pdf}
                documentId={documentId!}
                bookId={bookId}
                pageNumber={n}
                width={pageWidth}
                aspect={handle.aspect}
                visible
                registry={registry}
              />
            </div>
          ))}
        </div>
      </div>

      <SelectionMenu />
      <SnipOverlay pdf={handle.pdf} scrollRef={scrollRef} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

interface ToolbarProps {
  title: string
  arabicTitle?: string
  page: number
  pageCount: number
  zoom: number
  onPage: (page: number) => void
  onZoom: (zoom: number) => void
  onFitWidth: () => void
  onSnip: (mode: 'capture' | 'explain') => void
  snipActive: boolean
}

function Toolbar({
  title,
  arabicTitle,
  page,
  pageCount,
  zoom,
  onPage,
  onZoom,
  onFitWidth,
  onSnip,
  snipActive,
}: ToolbarProps) {
  const [draft, setDraft] = useState(String(page))
  useEffect(() => setDraft(String(page)), [page])

  const commit = () => {
    const n = Number(draft)
    if (Number.isFinite(n) && n >= 1 && n <= pageCount) onPage(Math.round(n))
    else setDraft(String(page))
  }

  return (
    <div className="border-line bg-panel flex h-11 shrink-0 items-center gap-2 border-b px-3">
      {/* §45/§46 — the book's own name reads first and large; the other name,
          which is often a long institutional filename, is secondary and muted. */}
      <div className="flex min-w-0 flex-1 items-baseline gap-2 truncate">
        <span className="text-ink shrink-0 truncate text-[13.5px] font-semibold" dir="auto">
          {title}
        </span>
        {arabicTitle && (
          <span className="text-ink-faint truncate text-[11px]" dir="auto" title={arabicTitle}>
            {arabicTitle}
          </span>
        )}
      </div>

      <div className="text-ink-muted flex items-center gap-1">
        <IconButton label="Previous page" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}>
          <Icon name="chevron-up" />
        </IconButton>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          aria-label="Page number"
          className="border-line bg-elevated text-ink h-7 w-11 rounded border text-center text-xs tabular-nums"
        />
        <span className="text-ink-faint text-xs tabular-nums">/ {pageCount}</span>
        <IconButton
          label="Next page"
          onClick={() => onPage(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
        >
          <Icon name="chevron-down" />
        </IconButton>
      </div>

      <div className="bg-line mx-1 h-5 w-px" />

      <div className="text-ink-muted flex items-center gap-1">
        <IconButton label="Zoom out" onClick={() => onZoom(zoom - 0.15)}>
          <Icon name="minus" />
        </IconButton>
        <button
          onClick={onFitWidth}
          title="Fit width"
          className="hover:bg-hover text-ink-muted h-7 min-w-12 rounded px-1 text-xs tabular-nums"
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton label="Zoom in" onClick={() => onZoom(zoom + 0.15)}>
          <Icon name="plus" />
        </IconButton>
      </div>

      <div className="bg-line mx-1 h-5 w-px" />

      {/* §D9 — capture lives beside zoom because it is a way of looking at the
          page, not a note-taking command. */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => onSnip('capture')}
          title="Snip a region into your notes"
          aria-label="Snip a region into your notes"
          aria-pressed={snipActive}
          className={`grid h-7 w-7 place-items-center rounded ${
            snipActive ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-hover hover:text-ink'
          }`}
        >
          <Icon name="snip" />
        </button>
        <button
          onClick={() => onSnip('explain')}
          title="Snip a region and start an explanation"
          aria-label="Snip a region and start an explanation"
          className="hover:bg-hover text-ink-muted hover:text-ink grid h-7 w-7 place-items-center rounded"
        >
          <Icon name="snip-explain" />
        </button>
      </div>
    </div>
  )
}

function IconButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="hover:bg-hover text-ink-muted hover:text-ink grid h-7 w-7 place-items-center rounded disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

/** Quiet on-demand OCR entry for genuinely image-only pages (§G1C). */
function OcrBanner({
  pdf,
  documentId,
  pageNumber,
}: {
  pdf: PDFDocumentProxy
  documentId: string
  pageNumber: number
}) {
  const page = useLiveQuery(() => pagesRepo.get(documentId, pageNumber), [documentId, pageNumber])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  if (!isImageOnlyPage(page)) return null
  if (page?.textSource === 'ocr' && page.hasTextLayer) return null

  return (
    <div className="ocr-banner">
      <span className="ocr-banner-label">Image-only page</span>
      <span className="ocr-banner-hint">
        {busy
          ? `Recognising text… ${Math.round(progress * 100)}%`
          : 'No selectable text layer — run OCR on this page.'}
      </span>
      <button
        type="button"
        disabled={busy}
        className="ocr-banner-action"
        onClick={() => {
          setBusy(true)
          setError(null)
          void ocrPdfPage(pdf, documentId, pageNumber, (p) => setProgress(p.progress))
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : 'OCR failed')
            })
            .finally(() => setBusy(false))
        }}
      >
        {busy ? 'Working…' : 'Recognise text'}
      </button>
      {error && <span className="ocr-banner-error">{error}</span>}
    </div>
  )
}

function ReaderMessage({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div className="empty-state">
      <p className={`empty-state-line ${tone === 'error' ? 'text-hl-rose' : ''}`}>{children}</p>
      {tone === 'error' && (
        <p className="empty-state-hint">The notes beside this book are unaffected.</p>
      )}
    </div>
  )
}

function EmptyReader() {
  return (
    <div className="empty-state">
      <div className="text-ink-faint font-arabic mb-1 text-2xl" dir="rtl">
        حاشية
      </div>
      <p className="empty-state-line">Open a book from the library, or drop a PDF anywhere.</p>
      <p className="empty-state-hint">
        Press <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> for commands
      </p>
    </div>
  )
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="border-line bg-elevated text-ink-muted rounded border px-1 py-px font-sans text-[10px]">
      {children}
    </kbd>
  )
}
