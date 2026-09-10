import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { anchorsRepo } from '@/db/repos/annotations'
import { noteDocsRepo } from '@/db/repos/notes'
import { pdfNoteLinksRepo } from '@/db/repos/pdfNoteLinks'
import { ContextMenu } from '@/features/shell/ContextMenu'
import { Icon } from '@/features/shell/Icon'
import { detectDirection } from '@/lib/dir'
import { MARK_DRAG_THRESHOLD, pointerDistance } from '@/features/pdf/pdfToolBehavior'
import { blockExists, findBlockPreview, findBlockTitle } from '@/services/notes/noteTargets'
import { PdfNoteLinkEngine } from '@/services/notes/PdfNoteLinkEngine'
import {
  clientToNormalized,
  displayPageBox,
  markCssBox,
  type PageRotation,
} from '@/services/pdf/pageCoords'
import { useStudyStore } from '@/state/useStudyStore'
import type { NormalizedRect, PdfNoteLink } from '@/types'

interface LabelRow {
  link: PdfNoteLink
  title: string
  missingTarget: boolean
  preview: string
  rects: NormalizedRect[]
}

export function PdfNoteLinkLayer({
  documentId,
  pageNumber,
  pageWidth,
  pageHeight,
  pageLeft,
  rotation,
}: {
  documentId: string
  pageNumber: number
  pageWidth: number
  pageHeight: number
  pageLeft: number
  rotation: PageRotation
}) {
  const rows =
    useLiveQuery(
      async (): Promise<LabelRow[]> => {
        const links = await pdfNoteLinksRepo.forPage(documentId, pageNumber)
        if (!links.length) return []
        const noteIds = [...new Set(links.map((l) => l.noteDocumentId))]
        const docs = await Promise.all(noteIds.map((id) => noteDocsRepo.get(id)))
        const byNote = new Map(docs.filter(Boolean).map((d) => [d!.noteId, d!]))
        const anchors = await Promise.all(links.map((l) => anchorsRepo.forAnnotation(l.annotationId)))
        return links.map((link, i) => {
          const stored = byNote.get(link.noteDocumentId)
          const liveTitle = stored ? findBlockTitle(stored.doc, link.noteBlockId) : null
          const missingTarget = !stored || !blockExists(stored.doc, link.noteBlockId)
          const { title } = PdfNoteLinkEngine.displayLabel(link, missingTarget ? null : liveTitle)
          const preview = stored && !missingTarget ? findBlockPreview(stored.doc, link.noteBlockId) : ''
          return { link, title, missingTarget, preview, rects: anchors[i]?.rects ?? [] }
        })
      },
      [documentId, pageNumber],
      [] as LabelRow[],
    )

  const selectedId = useStudyStore((s) => s.selectedPdfNoteLinkId)
  const jumpRequest = useStudyStore((s) => s.jumpRequest)
  const layerRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<{ id: string; x: number; y: number } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const gesture = useRef<{
    id: string
    pointerId: number
    start: { x: number; y: number }
    origin: { x: number; y: number }
    moved: boolean
  } | null>(null)
  const ignoreNextClick = useRef(false)

  useEffect(() => {
    if (!jumpRequest) return
    const hit = rows.find((row) => row.link.annotationId === jumpRequest.annotationId)
    if (!hit) return
    useStudyStore.getState().setSelectedPdfNoteLinkId(hit.link.id)
  }, [jumpRequest, rows])

  const pageBoxOf = () => {
    const el = layerRef.current
    if (!el) return null
    return displayPageBox(el.getBoundingClientRect(), pageLeft, pageWidth, pageHeight)
  }

  return (
    <div ref={layerRef} className="pdf-note-link-layer" aria-label="Linked notes">
      {rows.map((row) => {
        const x = draft?.id === row.link.id ? draft.x : row.link.labelX
        const y = draft?.id === row.link.id ? draft.y : row.link.labelY
        const box = markCssBox({ x, y, w: 0.001, h: 0.001 }, pageWidth, pageHeight, pageLeft, rotation)
        const source = row.rects[0]
        const sourceBox = source
          ? markCssBox(source, pageWidth, pageHeight, pageLeft, rotation)
          : null
        const pulsing = jumpRequest?.annotationId === row.link.annotationId
        const selected = selectedId === row.link.id
        const dir = detectDirection(row.title)
        return (
          <div key={row.link.id}>
            {row.link.connectorVisible && sourceBox && (
              <svg className="pdf-note-link-connector" aria-hidden="true">
                <line
                  x1={sourceBox.left + sourceBox.width}
                  y1={sourceBox.top + sourceBox.height / 2}
                  x2={box.left}
                  y2={box.top + 10}
                  stroke="currentColor"
                />
              </svg>
            )}
            <button
              type="button"
              className={[
                'pdf-note-link-label',
                selected ? 'is-selected' : '',
                pulsing ? 'is-pulse' : '',
                row.missingTarget ? 'is-missing' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ left: box.left, top: box.top }}
              dir={dir}
              title={row.title}
              aria-label={
                row.missingTarget
                  ? `Missing note for ${row.title}`
                  : `Open note ${row.title}`
              }
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                useStudyStore.getState().setSelectedPdfNoteLinkId(row.link.id)
                useStudyStore.getState().setAnnotationGesture(true)
                ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
                gesture.current = {
                  id: row.link.id,
                  pointerId: event.pointerId,
                  start: { x: event.clientX, y: event.clientY },
                  origin: { x: row.link.labelX, y: row.link.labelY },
                  moved: false,
                }
              }}
              onPointerMove={(event) => {
                const g = gesture.current
                if (!g || g.id !== row.link.id) return
                const dist = pointerDistance(g.start, { x: event.clientX, y: event.clientY })
                if (dist >= MARK_DRAG_THRESHOLD) g.moved = true
                if (!g.moved) return
                const page = pageBoxOf()
                if (!page) return
                const now = clientToNormalized({ x: event.clientX, y: event.clientY }, page, rotation)
                const start = clientToNormalized(g.start, page, rotation)
                setDraft({
                  id: row.link.id,
                  x: g.origin.x + (now.x - start.x),
                  y: g.origin.y + (now.y - start.y),
                })
              }}
              onPointerUp={(event) => {
                const g = gesture.current
                gesture.current = null
                useStudyStore.getState().setAnnotationGesture(false)
                ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
                if (!g) return
                ignoreNextClick.current = true
                if (g.moved) {
                  const page = pageBoxOf()
                  if (page) {
                    const now = clientToNormalized({ x: event.clientX, y: event.clientY }, page, rotation)
                    const start = clientToNormalized(g.start, page, rotation)
                    void PdfNoteLinkEngine.moveLabel(row.link.id, g.origin.x + (now.x - start.x), g.origin.y + (now.y - start.y))
                  }
                  setDraft(null)
                  return
                }
                setDraft(null)
                if (row.missingTarget) {
                  setMenu({ x: event.clientX, y: event.clientY, id: row.link.id })
                  return
                }
                void PdfNoteLinkEngine.revealNote(row.link)
              }}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (ignoreNextClick.current) {
                  ignoreNextClick.current = false
                  return
                }
                if (row.missingTarget) return
                void PdfNoteLinkEngine.revealNote(row.link)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setMenu({ x: event.clientX, y: event.clientY, id: row.link.id })
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  if (!row.missingTarget) void PdfNoteLinkEngine.revealNote(row.link)
                }
                if (event.key === 'Delete' || event.key === 'Backspace') {
                  event.preventDefault()
                  void PdfNoteLinkEngine.unlink(row.link.id)
                }
              }}
              onMouseEnter={() => setHoverId(row.link.id)}
              onMouseLeave={() => setHoverId((id) => (id === row.link.id ? null : id))}
              onFocus={() => setHoverId(row.link.id)}
              onBlur={() => setHoverId((id) => (id === row.link.id ? null : id))}
            >
              <Icon name="link" />
              {editingId === row.link.id ? (
                <input
                  className="pdf-note-link-edit"
                  defaultValue={row.link.customLabel ?? row.title}
                  aria-label="Custom label"
                  autoFocus
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') {
                      const value = (e.target as HTMLInputElement).value.trim()
                      void PdfNoteLinkEngine.setLabelMode(row.link.id, 'custom', value)
                      setEditingId(null)
                    }
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  onBlur={(e) => {
                    const value = e.target.value.trim()
                    if (value) void PdfNoteLinkEngine.setLabelMode(row.link.id, 'custom', value)
                    setEditingId(null)
                  }}
                />
              ) : (
                <span className="pdf-note-link-text">{row.title}</span>
              )}
            </button>
            {hoverId === row.link.id && !editingId && row.preview && !row.missingTarget && (
              <div
                className="pdf-note-link-preview"
                style={{ left: box.left, top: box.top + 28 }}
                dir={dir}
              >
                <div className="pdf-note-link-preview-title">{row.title}</div>
                <div className="pdf-note-link-preview-body">{row.preview}</div>
              </div>
            )}
          </div>
        )
      })}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="Linked note"
          onClose={() => setMenu(null)}
          items={[
            {
              id: 'open',
              label: 'Open note',
              disabled: rows.find((r) => r.link.id === menu.id)?.missingTarget,
              onSelect: () => {
                const row = rows.find((r) => r.link.id === menu.id)
                if (row && !row.missingTarget) void PdfNoteLinkEngine.revealNote(row.link)
              },
            },
            {
              id: 'relink',
              label: rows.find((r) => r.link.id === menu.id)?.missingTarget ? 'Relink…' : 'Change note…',
              onSelect: () => {
                const row = rows.find((r) => r.link.id === menu.id)
                if (!row) return
                const study = useStudyStore.getState()
                study.setLinkDraft({
                  capture: {
                    pageNumber: row.link.pageNumber,
                    text: '',
                    startOffset: 0,
                    endOffset: 0,
                    itemStart: 0,
                    itemEnd: 0,
                    textBefore: '',
                    textAfter: '',
                    occurrenceIndex: 0,
                    rects: row.rects,
                    pageWidth: 0,
                    pageHeight: 0,
                    pageRotation: rotation,
                  },
                  documentId,
                  bookId: study.bookId ?? '',
                  menuLeft: menu.x,
                  menuTop: menu.y,
                  relinkId: row.link.id,
                  anchorKind: row.link.anchorKind,
                })
              },
            },
            {
              id: 'custom',
              label: 'Customise label',
              onSelect: () => setEditingId(menu.id),
            },
            {
              id: 'sync',
              label: 'Use note title',
              onSelect: () => void PdfNoteLinkEngine.setLabelMode(menu.id, 'sync-with-note-title'),
            },
            {
              id: 'source',
              label: 'Show source',
              onSelect: () => {
                const row = rows.find((r) => r.link.id === menu.id)
                if (row) void PdfNoteLinkEngine.jumpToSource(row.link)
              },
            },
            {
              id: 'unlink',
              label: 'Unlink',
              danger: true,
              onSelect: () => void PdfNoteLinkEngine.unlink(menu.id),
            },
          ]}
        />
      )}
    </div>
  )
}
