import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ContextMenu } from '@/features/shell/ContextMenu'
import { MarkStyleBar } from '@/features/pdf/MarkStyleBar'
import { commitNewTextMark, createTrackedMark, deleteMark } from '@/features/pdf/annotationActions'
import { MARK_DRAG_THRESHOLD, marksReceivePointer, pointerDistance } from '@/features/pdf/pdfToolBehavior'
import {
  DEFAULT_HIGHLIGHT_HEX,
  DEFAULT_HIGHLIGHT_OPACITY,
  DEFAULT_UNDERLINE_HEX,
  effectiveLineRect,
  fontCss,
  hexToRgba,
  isLegacyAreaHighlight,
  isLegacyLineStroke,
  typewriterSurface,
  UNDERLINE_WIDTHS,
} from '@/services/annotations/appearance'
import { recordMarkUpdated } from '@/services/annotations/history'
import { MARK_COLORS, PageMarkEngine } from '@/services/annotations/PageMarkEngine'
import { detectDirection } from '@/lib/dir'
import {
  displayPageBox,
  isMarginRect,
  markCssBox,
  movedRect,
  resizedRectFromHandle,
  textRectFromDrag,
  type PageBox,
  type PageRotation,
  type ResizeHandle,
} from '@/services/pdf/pageCoords'
import { useStudyStore, type PdfTool } from '@/state/useStudyStore'
import type { NormalizedRect, PageMark, PageMarkStyle } from '@/types'

const MIN_W = 0.08
const MIN_H = 0.03

type Gesture = {
  mode: 'drag' | 'resize'
  pointerId: number
  startClient: { x: number; y: number }
  origin: NormalizedRect
  pageBox: PageBox
  rotation: PageRotation
  moved: boolean
  handle?: ResizeHandle
}

const RESIZE_HANDLES: ResizeHandle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

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
  const interactive = marksReceivePointer(tool)
  const [draftRect, setDraftRect] = useState<NormalizedRect | null>(null)
  const createGesture = useRef<{
    pointerId: number
    start: { x: number; y: number }
  } | null>(null)
  const [markMenu, setMarkMenu] = useState<{ x: number; y: number; id: string } | null>(null)

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (!createGesture.current && !draftRect) return
      event.preventDefault()
      event.stopPropagation()
      createGesture.current = null
      setDraftRect(null)
      useStudyStore.getState().setAnnotationGesture(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [draftRect])

  const finishCreate = (client: { x: number; y: number }) => {
    const active = createGesture.current
    createGesture.current = null
    setDraftRect(null)
    useStudyStore.getState().setAnnotationGesture(false)
    const metrics = pageMetrics()
    if (!active || !metrics) return
    const rect = textRectFromDrag(active.start, client, metrics.box, rotation, pageWidth, pageHeight)
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

  const onBackgroundPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('.page-mark, .mark-style-bar, .node-menu')) return
    if (tool !== 'text') {
      if (tool === 'select' || tool === 'erase') {
        setSelected(null)
        setEditing(null)
      }
      return
    }
    event.preventDefault()
    const metrics = pageMetrics()
    if (!metrics) return
    createGesture.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY } }
    useStudyStore.getState().setAnnotationGesture(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  return (
    <div
      ref={layerRef}
      className={[
        'page-mark-layer',
        tool === 'text' ? 'is-drawing' : '',
        tool === 'pan' ? 'is-panning' : '',
        interactive ? 'is-interactive' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={(event) => {
        const active = createGesture.current
        if (!active || active.pointerId !== event.pointerId) return
        const metrics = pageMetrics()
        if (!metrics) return
        if (pointerDistance(active.start, { x: event.clientX, y: event.clientY }) < MARK_DRAG_THRESHOLD) return
        setDraftRect(textRectFromDrag(active.start, { x: event.clientX, y: event.clientY }, metrics.box, rotation, pageWidth, pageHeight))
      }}
      onPointerUp={(event) => {
        if (createGesture.current?.pointerId === event.pointerId) {
          finishCreate({ x: event.clientX, y: event.clientY })
        }
      }}
      onPointerCancel={() => {
        createGesture.current = null
        setDraftRect(null)
        useStudyStore.getState().setAnnotationGesture(false)
      }}
    >
      {draftRect && (
        <div
          className="page-mark-draft"
          style={markCssBox(draftRect, pageWidth, pageHeight, pageLeft, rotation)}
        />
      )}
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
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setSelected(mark.id)
            setMarkMenu({ x: event.clientX, y: event.clientY, id: mark.id })
          }}
        />
      ))}
      {markMenu && (
        <ContextMenu
          x={markMenu.x}
          y={markMenu.y}
          label="Annotation"
          onClose={() => setMarkMenu(null)}
          items={[
            {
              id: 'props',
              label: 'Properties',
              onSelect: () => {
                setSelected(markMenu.id)
                setEditing(null)
              },
            },
            {
              id: 'colour',
              label: 'Change colour',
              onSelect: () => {
                setSelected(markMenu.id)
                setEditing(null)
              },
            },
            {
              id: 'delete',
              label: 'Delete',
              danger: true,
              onSelect: () => void deleteMark(markMenu.id),
            },
          ]}
        />
      )}
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
  onContextMenu,
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
  onContextMenu: (event: React.MouseEvent) => void
}) {
  const tool = useStudyStore((s) => s.pdfTool)
  const setEditing = useStudyStore((s) => s.setEditingMarkId)

  if (mark.kind === 'area' || mark.kind === 'line') {
    return (
      <ShapeMark
        mark={mark}
        pageWidth={pageWidth}
        pageHeight={pageHeight}
        pageLeft={pageLeft}
        rotation={rotation}
        selected={selected}
        pageBoxOf={pageBoxOf}
        onSelect={onSelect}
        onContextMenu={onContextMenu}
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
      onContextMenu={onContextMenu}
      tool={tool}
    />
  )
}

function ShapeMark({
  mark,
  pageWidth,
  pageHeight,
  pageLeft,
  rotation,
  selected,
  pageBoxOf,
  onSelect,
  onContextMenu,
}: {
  mark: PageMark
  pageWidth: number
  pageHeight: number
  pageLeft: number
  rotation: PageRotation
  selected: boolean
  pageBoxOf: () => { box: PageBox; rotation: PageRotation } | null
  onSelect: () => void
  onContextMenu: (event: React.MouseEvent) => void
}) {
  const tool = useStudyStore((s) => s.pdfTool)
  const [liveRect, setLiveRect] = useState<NormalizedRect | null>(null)
  const liveRectRef = useRef<NormalizedRect | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const beforeMove = useRef<PageMark | null>(null)
  const setGesture = useStudyStore((s) => s.setAnnotationGesture)

  useEffect(() => {
    if (!gesture.current) {
      liveRectRef.current = null
      setLiveRect(null)
    }
  }, [mark.rect])

  const stored = liveRect ?? mark.rect
  const rect = mark.kind === 'line' ? effectiveLineRect(stored, mark.style) : stored
  const box = markCssBox(rect, pageWidth, pageHeight, pageLeft, rotation)
  const isLine = mark.kind === 'line'
  const legacyLine = isLine && isLegacyLineStroke(mark.style, stored)
  const lineColor = legacyLine
    ? DEFAULT_UNDERLINE_HEX
    : (mark.style.strokeColor ?? mark.style.color ?? DEFAULT_UNDERLINE_HEX)
  const areaFill = isLegacyAreaHighlight(mark.style)
    ? hexToRgba(DEFAULT_HIGHLIGHT_HEX, DEFAULT_HIGHLIGHT_OPACITY)
    : hexToRgba(mark.style.fillColor ?? DEFAULT_HIGHLIGHT_HEX, mark.style.fillOpacity ?? DEFAULT_HIGHLIGHT_OPACITY)

  const previewRect = (next: NormalizedRect) => {
    liveRectRef.current = next
    setLiveRect(next)
  }

  const finishGesture = async () => {
    setGesture(false)
    const next = liveRectRef.current
    const active = gesture.current
    gesture.current = null
    liveRectRef.current = null
    if (!next || !active?.moved) {
      setLiveRect(null)
      return
    }
    const before = beforeMove.current
    await PageMarkEngine.update(mark.id, { rect: next })
    const after = await PageMarkEngine.get(mark.id)
    if (before && after && rectChanged(before.rect, after.rect)) {
      recordMarkUpdated(before, after)
    }
    beforeMove.current = null
    setLiveRect(null)
  }

  const patchColor = (color: string) => {
    void (async () => {
      const before = await PageMarkEngine.get(mark.id)
      const style = isLine
        ? { ...mark.style, color, strokeColor: color }
        : { ...mark.style, fillColor: color }
      await PageMarkEngine.update(mark.id, { style })
      const after = await PageMarkEngine.get(mark.id)
      if (before && after) recordMarkUpdated(before, after)
    })()
  }

  return (
    <div
      className={`page-mark ${isLine ? 'page-mark-line' : 'page-mark-area'}${selected ? ' is-selected' : ''}`}
      style={
        isLine
          ? {
              left: box.left,
              top: box.top,
              width: Math.max(box.width, 2),
              height: Math.max(box.height, 0.75),
              background: lineColor,
            }
          : {
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              background: areaFill,
            }
      }
      onContextMenu={onContextMenu}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.button !== 0) return
        if (tool === 'erase') {
          void deleteMark(mark.id)
          return
        }
        if (tool === 'pan' || !marksReceivePointer(tool)) return
        onSelect()
        if (tool !== 'select') return
        const metrics = pageBoxOf()
        if (!metrics) return
        beforeMove.current = mark
        gesture.current = {
          mode: 'drag',
          pointerId: event.pointerId,
          startClient: { x: event.clientX, y: event.clientY },
          origin: stored,
          pageBox: metrics.box,
          rotation: metrics.rotation,
          moved: false,
        }
        ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const active = gesture.current
        if (!active || active.pointerId !== event.pointerId) return
        if (!active.moved && pointerDistance(active.startClient, { x: event.clientX, y: event.clientY }) < MARK_DRAG_THRESHOLD) {
          return
        }
        if (!active.moved) {
          active.moved = true
          setGesture(true)
        }
        previewRect(movedRect(active.origin, active.startClient, { x: event.clientX, y: event.clientY }, active.pageBox, active.rotation))
      }}
      onPointerUp={(event) => {
        if (gesture.current?.pointerId === event.pointerId) void finishGesture()
      }}
      onPointerCancel={() => {
        gesture.current = null
        liveRectRef.current = null
        setLiveRect(null)
        setGesture(false)
      }}
    >
      {selected && tool === 'select' && (
        <StrokeColorBar
          color={isLine ? (mark.style.strokeColor ?? mark.style.color) : (mark.style.fillColor ?? mark.style.color)}
          onChange={patchColor}
          line={isLine}
          thickness={rect.h}
          onThickness={(h) => {
            void (async () => {
              const before = await PageMarkEngine.get(mark.id)
              const next = { ...mark.rect, h, y: mark.rect.y + (mark.rect.h - h) / 2 }
              await PageMarkEngine.update(mark.id, { rect: next, style: { ...mark.style, strokeWidth: 1 } })
              const after = await PageMarkEngine.get(mark.id)
              if (before && after) recordMarkUpdated(before, after)
            })()
          }}
        />
      )}
    </div>
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
  onContextMenu,
  tool,
}: {
  mark: PageMark
  pageWidth: number
  pageHeight: number
  pageLeft: number
  rotation: PageRotation
  selected: boolean
  editing: boolean
  pageBoxOf: () => { box: PageBox; rotation: PageRotation } | null
  onSelect: () => void
  onEdit: () => void
  onContextMenu: (event: React.MouseEvent) => void
  tool: PdfTool
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(mark.content)
  const draftRef = useRef(mark.content)
  const lastSaved = useRef(mark.content)
  const [liveRect, setLiveRect] = useState<NormalizedRect | null>(null)
  const liveRectRef = useRef<NormalizedRect | null>(null)
  const isFresh = useRef(editing && !mark.content.trim())
  const selectedOnDown = useRef(false)
  const gesture = useRef<Gesture | null>(null)
  const beforeMove = useRef<PageMark | null>(null)
  const persistOnEditExit = useRef(false)
  const persistContentRef = useRef<(mode: 'save' | 'save-or-discard') => Promise<void>>(async () => {})
  const setEditing = useStudyStore((s) => s.setEditingMarkId)
  const setGestureFlag = useStudyStore((s) => s.setAnnotationGesture)

  draftRef.current = draft

  useEffect(() => setDraft(mark.content), [mark.content])
  useEffect(() => {
    lastSaved.current = mark.content
  }, [mark.id, mark.content])

  useEffect(() => {
    if (!gesture.current) {
      liveRectRef.current = null
      setLiveRect(null)
    }
  }, [mark.rect])

  const rect = liveRect ?? mark.rect
  const box = markCssBox(rect, pageWidth, pageHeight, pageLeft, rotation)
  const dir = mark.style.direction === 'auto' ? detectDirection(draft, 'rtl') : mark.style.direction
  const align =
    mark.style.align === 'center' ? 'center' : mark.style.align === 'end' ? 'end' : dir === 'rtl' ? 'right' : 'left'
  const chrome = typewriterSurface(mark.style)

  const previewRect = (next: NormalizedRect) => {
    liveRectRef.current = next
    setLiveRect(next)
  }

  const persistContent = async (mode: 'save' | 'save-or-discard') => {
    const content = draftRef.current
    if (mode === 'save-or-discard' && !content.trim() && isFresh.current) {
      await PageMarkEngine.remove(mark.id)
      const study = useStudyStore.getState()
      if (study.selectedMarkId === mark.id) study.setSelectedMarkId(null)
      if (study.editingMarkId === mark.id) study.setEditingMarkId(null)
      return
    }
    if (content === lastSaved.current) {
      if (isFresh.current && content.trim()) {
        const current = await PageMarkEngine.get(mark.id)
        if (current) commitNewTextMark(current)
        isFresh.current = false
      }
      return
    }
    const before = await PageMarkEngine.get(mark.id)
    if (!before) return
    await PageMarkEngine.update(mark.id, { content, kind: isMarginRect(before.rect) ? 'margin' : 'text' })
    lastSaved.current = content
    const after = await PageMarkEngine.get(mark.id)
    if (isFresh.current && after) {
      commitNewTextMark(after)
      isFresh.current = false
    } else if (before && after && before.content !== after.content) {
      recordMarkUpdated(before, after)
    }
  }

  persistContentRef.current = persistContent

  useEffect(() => {
    if (editing) {
      persistOnEditExit.current = true
      textareaRef.current?.focus()
      if (isFresh.current && !draftRef.current.trim()) textareaRef.current?.select()
      return
    }
    if (persistOnEditExit.current) {
      persistOnEditExit.current = false
      void persistContentRef.current('save-or-discard')
    }
  }, [editing])

  const finishGesture = async (wasSelected: boolean) => {
    const active = gesture.current
    gesture.current = null
    setGestureFlag(false)
    const next = liveRectRef.current
    liveRectRef.current = null
    if (active?.moved && next) {
      const before = beforeMove.current
      await PageMarkEngine.update(mark.id, { rect: next, kind: isMarginRect(next) ? 'margin' : 'text' })
      const after = await PageMarkEngine.get(mark.id)
      if (before && after && rectChanged(before.rect, after.rect)) {
        recordMarkUpdated(before, after)
      }
      beforeMove.current = null
      setLiveRect(null)
      return
    }
    setLiveRect(null)
    beforeMove.current = null
    if (active && !active.moved && wasSelected && !editing) onEdit()
  }

  const patchStyle = (patch: Partial<PageMarkStyle>) => {
    void (async () => {
      const before = await PageMarkEngine.get(mark.id)
      await PageMarkEngine.update(mark.id, { style: { ...mark.style, ...patch } })
      const after = await PageMarkEngine.get(mark.id)
      if (before && after) recordMarkUpdated(before, after)
    })()
  }

  const beginDrag = (event: React.PointerEvent, mode: 'drag' | 'resize', handle: ResizeHandle = 'se') => {
    const metrics = pageBoxOf()
    if (!metrics) return
    event.preventDefault()
    beforeMove.current = mark
    gesture.current = {
      mode,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      origin: rect,
      pageBox: metrics.box,
      rotation: metrics.rotation,
      moved: false,
      handle,
    }
    const root = (event.currentTarget as HTMLElement).closest('.page-mark') as HTMLElement | null
    root?.setPointerCapture(event.pointerId)
  }

  return (
    <div
      className={`page-mark page-mark-note${selected ? ' is-selected' : ''}${isMarginRect(rect) ? ' is-margin' : ''}${editing ? ' is-editing' : ''}`}
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        color: chrome.color,
        background: chrome.background,
        border: chrome.border,
        boxShadow: chrome.boxShadow,
        fontSize: mark.style.fontSize,
        textAlign: align,
        fontFamily: fontCss(mark.style, dir),
      }}
      tabIndex={selected ? 0 : -1}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && selected && !editing) {
          event.preventDefault()
          onEdit()
        }
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.button !== 0) return
        if (tool === 'erase') {
          void deleteMark(mark.id)
          return
        }
        if (tool === 'pan' || !marksReceivePointer(tool)) return
        if ((event.target as HTMLElement).closest('.mark-style-bar')) return
        selectedOnDown.current = selected
        onSelect()
        if ((event.target as HTMLElement).closest('.page-mark-resize')) return
        if (editing && (event.target as HTMLElement).closest('textarea')) return
        if (tool === 'text') {
          if (!editing) onEdit()
          return
        }
        if (editing) return
        beginDrag(event, 'drag')
      }}
      onPointerMove={(event) => {
        const active = gesture.current
        if (!active || active.pointerId !== event.pointerId) return
        const now = { x: event.clientX, y: event.clientY }
        if (!active.moved && pointerDistance(active.startClient, now) < MARK_DRAG_THRESHOLD) return
        if (!active.moved) {
          active.moved = true
          setGestureFlag(true)
        }
        if (active.mode === 'resize') {
          previewRect(
            resizedRectFromHandle(
              active.origin,
              active.startClient,
              now,
              active.pageBox,
              active.rotation,
              active.handle ?? 'se',
              MIN_W,
              MIN_H,
            ),
          )
          return
        }
        previewRect(movedRect(active.origin, active.startClient, now, active.pageBox, active.rotation))
      }}
      onPointerUp={(event) => {
        if (gesture.current?.pointerId === event.pointerId) {
          void finishGesture(selectedOnDown.current)
        }
      }}
      onPointerCancel={() => {
        gesture.current = null
        liveRectRef.current = null
        setLiveRect(null)
        setGestureFlag(false)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (marksReceivePointer(tool) && tool !== 'erase') onEdit()
      }}
    >
      {selected && <MarkStyleBar style={mark.style} onChange={patchStyle} />}
      <div className="page-mark-frame" aria-hidden />
      <textarea
        ref={textareaRef}
        className="page-mark-text"
        dir={mark.style.direction === 'auto' ? 'auto' : mark.style.direction}
        value={draft}
        readOnly={!editing}
        placeholder=""
        rows={2}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          const next = event.relatedTarget as HTMLElement | null
          if (next?.closest('.page-mark')) {
            void persistContent('save')
            return
          }
          void persistContent('save-or-discard')
          setEditing(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            if (!draft.trim() && isFresh.current) {
              void PageMarkEngine.remove(mark.id)
              useStudyStore.getState().setSelectedMarkId(null)
              useStudyStore.getState().setEditingMarkId(null)
              return
            }
            persistOnEditExit.current = false
            void persistContent('save')
            setEditing(null)
            textareaRef.current?.blur()
          }
        }}
      />
      {selected && !editing &&
        RESIZE_HANDLES.map((handle) => (
          <span
            key={handle}
            className={`page-mark-resize is-${handle}`}
            onPointerDown={(event) => {
              event.stopPropagation()
              selectedOnDown.current = selected
              onSelect()
              beginDrag(event, 'resize', handle)
              setGestureFlag(true)
            }}
          />
        ))}
    </div>
  )
}

function StrokeColorBar({
  color,
  onChange,
  line,
  thickness,
  onThickness,
}: {
  color: string
  onChange: (color: string) => void
  line?: boolean
  thickness?: number
  onThickness?: (h: number) => void
}) {
  return (
    <div
      className="mark-style-bar"
      role="toolbar"
      aria-label="Mark colour"
      onPointerDown={(event) => {
        event.stopPropagation()
        event.preventDefault()
      }}
    >
      {MARK_COLORS.map((value) => (
        <button
          key={value}
          type="button"
          title={value}
          aria-label={`Colour ${value}`}
          aria-pressed={color === value}
          className={`mark-swatch${color === value ? ' is-active' : ''}`}
          style={{ background: value }}
          onClick={() => onChange(value)}
        />
      ))}
      {line && onThickness && (
        <>
          <span className="pdf-annot-sep" />
          {UNDERLINE_WIDTHS.map((width) => (
            <button
              key={width.id}
              type="button"
              className={`mark-style-chip${Math.abs((thickness ?? 0) - width.thickness) < 0.0004 ? ' is-active' : ''}`}
              aria-pressed={Math.abs((thickness ?? 0) - width.thickness) < 0.0004}
              onClick={() => onThickness(width.thickness)}
            >
              {width.label}
            </button>
          ))}
        </>
      )}
    </div>
  )
}

function rectChanged(a: NormalizedRect, b: NormalizedRect): boolean {
  return a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h
}
