import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { MarkStyleBar } from '@/features/pdf/MarkStyleBar'
import { commitNewTextMark, createTrackedMark, deleteMark } from '@/features/pdf/annotationActions'
import { recordMarkUpdated } from '@/services/annotations/history'
import { PageMarkEngine } from '@/services/annotations/PageMarkEngine'
import { detectDirection } from '@/lib/dir'
import {
  clientToNormalized,
  defaultTextRect,
  displayPageBox,
  isMarginRect,
  markCssBox,
  type PageBox,
  type PageRotation,
} from '@/services/pdf/pageCoords'
import { useStudyStore } from '@/state/useStudyStore'
import type { NormalizedRect, PageMark, PageMarkStyle } from '@/types'

const MIN_W = 0.08
const MIN_H = 0.03

export function PageMarkLayer({
  documentId,
  bookId,
  pageNumber,
  pageWidth,
  pageHeight,
  pageLeft,
  rotation,
  pdfPageWidth,
  pdfPageHeight,
}: {
  documentId: string
  bookId: string
  pageNumber: number
  pageWidth: number
  pageHeight: number
  pageLeft: number
  rotation: PageRotation
  pdfPageWidth: number
  pdfPageHeight: number
}) {
  const marks = useLiveQuery(
    () => PageMarkEngine.forPage(documentId, pageNumber),
    [documentId, pageNumber],
    [] as PageMark[],
  )
  const tool = useStudyStore((s) => s.pdfTool)
  const selectedId = useStudyStore((s) => s.selectedMarkId)
  const editingId = useStudyStore((s) => s.editingMarkId)
  const setSelected = useStudyStore((s) => s.setSelectedMarkId)
  const setEditing = useStudyStore((s) => s.setEditingMarkId)
  const layerRef = useRef<HTMLDivElement>(null)

  const pageMetrics = () => {
    const layer = layerRef.current?.getBoundingClientRect()
    if (!layer) return null
    return {
      box: displayPageBox(layer, pageLeft, pageWidth, pageHeight),
      pageWidth,
      pageHeight,
      pageLeft,
      rotation,
    }
  }

  const onBackgroundPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('.page-mark')) return
    if (tool !== 'text') {
      if (tool === 'select') {
        setSelected(null)
        setEditing(null)
      }
      return
    }
    event.preventDefault()
    const metrics = pageMetrics()
    if (!metrics) return
    const origin = clientToNormalized({ x: event.clientX, y: event.clientY }, metrics.box, rotation)
    const rect = defaultTextRect(origin, pageWidth, pageHeight)
    void createTrackedMark({
      bookId,
      documentId,
      pageNumber,
      rect,
      pageRotation: rotation,
      pageWidth: pdfPageWidth,
      pageHeight: pdfPageHeight,
    }).then((mark) => {
      setSelected(mark.id)
      setEditing(mark.id)
    })
  }

  return (
    <div
      ref={layerRef}
      className={`page-mark-layer${tool === 'text' ? ' is-drawing' : ''}${tool === 'pan' ? ' is-panning' : ''}`}
      onPointerDown={onBackgroundPointerDown}
    >
      {marks.map((mark) => (
        <MarkItem
          key={mark.id}
          mark={mark}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          pageLeft={pageLeft}
          rotation={rotation}
          selected={selectedId === mark.id}
          editing={editingId === mark.id}
          pageBoxOf={pageMetrics}
          onSelect={() => {
            setSelected(mark.id)
            useStudyStore.getState().setActiveAnnotation(null)
          }}
        />
      ))}
    </div>
  )
}

function MarkItem({
  mark,
  pageWidth,
  pageHeight,
  pageLeft,
  rotation,
  selected,
  editing,
  pageBoxOf,
  onSelect,
}: {
  mark: PageMark
  pageWidth: number
  pageHeight: number
  pageLeft: number
  rotation: PageRotation
  selected: boolean
  editing: boolean
  pageBoxOf: () => { box: PageBox; pageWidth: number; pageHeight: number; pageLeft: number; rotation: PageRotation } | null
  onSelect: () => void
}) {
  const tool = useStudyStore((s) => s.pdfTool)
  const setEditing = useStudyStore((s) => s.setEditingMarkId)
  const box = markCssBox(mark.rect, pageWidth, pageHeight, pageLeft, rotation)

  if (mark.kind === 'area') {
    return (
      <div
        className={`page-mark page-mark-area${selected ? ' is-selected' : ''}`}
        style={{
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          background: colorWithOpacity(mark.style.fillColor ?? '#d8a13d', mark.style.fillOpacity ?? 0.28),
        }}
        onPointerDown={(event) => {
          event.stopPropagation()
          if (tool === 'erase') {
            void deleteMark(mark.id)
            return
          }
          onSelect()
        }}
      />
    )
  }

  if (mark.kind === 'line') {
    return (
      <div
        className={`page-mark page-mark-line${selected ? ' is-selected' : ''}`}
        style={{
          left: box.left,
          top: box.top,
          width: Math.max(box.width, 2),
          height: Math.max(box.height, mark.style.strokeWidth ?? 2),
          background: mark.style.strokeColor ?? mark.style.color,
        }}
        onPointerDown={(event) => {
          event.stopPropagation()
          if (tool === 'erase') {
            void deleteMark(mark.id)
            return
          }
          onSelect()
        }}
      />
    )
  }

  return (
    <TextMark
      mark={mark}
      pageWidth={pageWidth}
      pageHeight={pageHeight}
      pageLeft={pageLeft}
      rotation={rotation}
      selected={selected}
      editing={editing}
      pageBoxOf={pageBoxOf}
      onSelect={onSelect}
      onEdit={() => setEditing(mark.id)}
    />
  )
}

function TextMark({
  mark,
  pageWidth,
  pageHeight,
  pageLeft,
  rotation,
  selected,
  editing,
  pageBoxOf,
  onSelect,
  onEdit,
}: {
  mark: PageMark
  pageWidth: number
  pageHeight: number
  pageLeft: number
  rotation: PageRotation
  selected: boolean
  editing: boolean
  pageBoxOf: () => { box: PageBox; pageWidth: number; pageHeight: number; pageLeft: number; rotation: PageRotation } | null
  onSelect: () => void
  onEdit: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(mark.content)
  const [liveRect, setLiveRect] = useState<NormalizedRect | null>(null)
  const liveRectRef = useRef<NormalizedRect | null>(null)
  const createdEmpty = useRef(!mark.content.trim())
  const drag = useRef<{
    pointerId: number
    startClient: { x: number; y: number }
    origin: NormalizedRect
    pageBox: PageBox
    rotation: PageRotation
  } | null>(null)
  const resize = useRef<{
    pointerId: number
    startClient: { x: number; y: number }
    origin: NormalizedRect
    pageBox: PageBox
    rotation: PageRotation
  } | null>(null)
  const beforeMove = useRef<PageMark | null>(null)
  const tool = useStudyStore((s) => s.pdfTool)
  const setEditing = useStudyStore((s) => s.setEditingMarkId)
  const setGesture = useStudyStore((s) => s.setAnnotationGesture)

  useEffect(() => setDraft(mark.content), [mark.content])
  useEffect(() => {
    if (!drag.current && !resize.current) {
      liveRectRef.current = null
      setLiveRect(null)
    }
  }, [mark.rect])

  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus()
      textareaRef.current?.select()
    }
  }, [editing])

  const rect = liveRect ?? mark.rect
  const box = markCssBox(rect, pageWidth, pageHeight, pageLeft, rotation)
  const dir = mark.style.direction === 'auto' ? detectDirection(draft, 'rtl') : mark.style.direction
  const align =
    mark.style.align === 'center' ? 'center' : mark.style.align === 'end' ? 'end' : dir === 'rtl' ? 'right' : 'left'

  const previewRect = (next: NormalizedRect) => {
    liveRectRef.current = next
    setLiveRect(next)
  }

  const finishGesture = async () => {
    setGesture(false)
    const next = liveRectRef.current
    drag.current = null
    resize.current = null
    liveRectRef.current = null
    if (!next) return
    const before = beforeMove.current
    await PageMarkEngine.update(mark.id, { rect: next, kind: isMarginRect(next) ? 'margin' : 'text' })
    const after = await PageMarkEngine.get(mark.id)
    if (before && after && (after.rect.x !== before.rect.x || after.rect.y !== before.rect.y || after.rect.w !== before.rect.w || after.rect.h !== before.rect.h)) {
      recordMarkUpdated(before, after)
    }
    beforeMove.current = null
    setLiveRect(null)
  }

  const onBlur = () => {
    const content = draft
    void (async () => {
      if (!content.trim() && createdEmpty.current) {
        await PageMarkEngine.remove(mark.id)
        useStudyStore.getState().setSelectedMarkId(null)
        useStudyStore.getState().setEditingMarkId(null)
        return
      }
      const before = await PageMarkEngine.get(mark.id)
      await PageMarkEngine.update(mark.id, { content, kind: isMarginRect(mark.rect) ? 'margin' : 'text' })
      const after = await PageMarkEngine.get(mark.id)
      if (createdEmpty.current && after) {
        commitNewTextMark(after)
        createdEmpty.current = false
      } else if (before && after && before.content !== after.content) {
        recordMarkUpdated(before, after)
      }
      setEditing(null)
    })()
  }

  const patchStyle = (patch: Partial<PageMarkStyle>) => {
    void (async () => {
      const before = await PageMarkEngine.get(mark.id)
      await PageMarkEngine.update(mark.id, { style: { ...mark.style, ...patch } })
      const after = await PageMarkEngine.get(mark.id)
      if (before && after) recordMarkUpdated(before, after)
    })()
  }

  return (
    <div
      className={`page-mark page-mark-note${selected ? ' is-selected' : ''}${isMarginRect(rect) ? ' is-margin' : ''}${editing ? ' is-editing' : ''}`}
      style={{
        left: box.left,
        top: box.top,
        width: Math.max(box.width, 96),
        minHeight: box.height,
        color: mark.style.color,
        fontSize: mark.style.fontSize,
        textAlign: align,
        fontFamily: dir === 'rtl' ? 'var(--font-arabic), serif' : 'var(--font-sans), sans-serif',
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (tool === 'erase') {
          void deleteMark(mark.id)
          return
        }
        if (tool === 'pan') return
        onSelect()
        if ((event.target as HTMLElement).closest('.page-mark-resize')) return
        if ((event.target as HTMLElement).closest('textarea')) return
        if (editing) return
        const metrics = pageBoxOf()
        if (!metrics) return
        beforeMove.current = mark
        drag.current = {
          pointerId: event.pointerId,
          startClient: { x: event.clientX, y: event.clientY },
          origin: rect,
          pageBox: metrics.box,
          rotation: metrics.rotation,
        }
        setGesture(true)
        ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const active = resize.current ?? drag.current
        if (!active) return
        const start = clientToNormalized(active.startClient, active.pageBox, active.rotation)
        const now = clientToNormalized({ x: event.clientX, y: event.clientY }, active.pageBox, active.rotation)
        const dx = now.x - start.x
        const dy = now.y - start.y
        if (resize.current) {
          previewRect({
            ...active.origin,
            w: Math.max(MIN_W, active.origin.w + dx),
            h: Math.max(MIN_H, active.origin.h + dy),
          })
          return
        }
        previewRect({
          ...active.origin,
          x: active.origin.x + dx,
          y: active.origin.y + dy,
        })
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId === event.pointerId || resize.current?.pointerId === event.pointerId) {
          void finishGesture()
        }
      }}
      onPointerCancel={() => {
        drag.current = null
        resize.current = null
        liveRectRef.current = null
        setLiveRect(null)
        setGesture(false)
      }}
      onDoubleClick={() => onEdit()}
    >
      {selected && <MarkStyleBar style={mark.style} onChange={patchStyle} />}
      <div className="page-mark-frame" aria-hidden />
      <textarea
        ref={textareaRef}
        className="page-mark-text"
        dir={mark.style.direction === 'auto' ? 'auto' : mark.style.direction}
        value={draft}
        readOnly={!editing}
        placeholder="Note"
        rows={2}
        onChange={(event) => setDraft(event.target.value)}
        onPointerDown={(event) => {
          event.stopPropagation()
          onSelect()
          if (!editing) onEdit()
        }}
        onBlur={onBlur}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            if (!draft.trim() && createdEmpty.current) {
              void PageMarkEngine.remove(mark.id)
              useStudyStore.getState().setSelectedMarkId(null)
              useStudyStore.getState().setEditingMarkId(null)
              return
            }
            textareaRef.current?.blur()
          }
        }}
      />
      {selected && !editing && (
        <span
          className="page-mark-resize"
          onPointerDown={(event) => {
            event.stopPropagation()
            const metrics = pageBoxOf()
            if (!metrics) return
            beforeMove.current = mark
            resize.current = {
              pointerId: event.pointerId,
              startClient: { x: event.clientX, y: event.clientY },
              origin: rect,
              pageBox: metrics.box,
              rotation: metrics.rotation,
            }
            setGesture(true)
            ;(event.currentTarget.parentElement as HTMLElement)?.setPointerCapture(event.pointerId)
          }}
        />
      )}
    </div>
  )
}

function colorWithOpacity(hex: string, opacity: number): string {
  const raw = hex.replace('#', '')
  if (raw.length !== 6) return hex
  const n = Number.parseInt(raw, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}
