import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Editor } from '@tiptap/core'
import { pdfNoteLinksRepo } from '@/db/repos/pdfNoteLinks'
import { PdfNoteLinkEngine } from '@/services/notes/PdfNoteLinkEngine'
import type { PdfNoteLink } from '@/types'

/**
 * Reverse source chips: one per PDF link targeting a block in this note.
 * Positioned from the rendered `[data-block-id]` after each editor update.
 */
export function NoteSourceChips({
  editor,
  scrollRef,
  noteId,
}: {
  editor: Editor
  scrollRef: React.RefObject<HTMLElement | null>
  noteId: string
}) {
  const links = useLiveQuery(() => pdfNoteLinksRepo.forNote(noteId), [noteId], [] as PdfNoteLink[])
  const [labels, setLabels] = useState<Record<string, { text: string; missingPdf: boolean }>>({})
  const [boxes, setBoxes] = useState<Record<string, { top: number; left: number }>>({})

  useEffect(() => {
    let cancelled = false
    void Promise.all(links.map(async (link) => [link.id, await PdfNoteLinkEngine.sourceChipLabel(link)] as const)).then(
      (rows) => {
        if (cancelled) return
        const next: Record<string, { text: string; missingPdf: boolean }> = {}
        for (const [id, info] of rows) next[id] = { text: info.text, missingPdf: info.missingPdf }
        setLabels(next)
      },
    )
    return () => {
      cancelled = true
    }
  }, [links])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const measure = () => {
      const next: Record<string, { top: number; left: number }> = {}
      const seen = new Set<string>()
      const containerBox = container.getBoundingClientRect()
      for (const link of links) {
        if (seen.has(link.noteBlockId)) continue
        const el = container.querySelector<HTMLElement>(
          typeof CSS !== 'undefined' && CSS.escape
            ? `[data-block-id="${CSS.escape(link.noteBlockId)}"]`
            : `[data-block-id="${link.noteBlockId}"]`,
        )
        if (!el) continue
        seen.add(link.noteBlockId)
        const box = el.getBoundingClientRect()
        next[link.noteBlockId] = {
          top: box.top - containerBox.top + container.scrollTop,
          left: box.left - containerBox.left + container.scrollLeft,
        }
      }
      setBoxes((prev) => {
        const keys = Object.keys(next)
        if (
          keys.length === Object.keys(prev).length &&
          keys.every((key) => prev[key]?.top === next[key]?.top && prev[key]?.left === next[key]?.left)
        ) {
          return prev
        }
        return next
      })
    }

    let raf = 0
    const measureSoon = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        measure()
      })
    }
    measure()
    editor.on('update', measureSoon)
    editor.on('transaction', measureSoon)
    container.addEventListener('scroll', measure, { passive: true })
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureSoon) : null
    observer?.observe(container)
    return () => {
      cancelAnimationFrame(raf)
      editor.off('update', measureSoon)
      editor.off('transaction', measureSoon)
      container.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [editor, links, scrollRef])

  if (!links.length) return null

  const byBlock = new Map<string, PdfNoteLink[]>()
  for (const link of links) {
    const list = byBlock.get(link.noteBlockId) ?? []
    list.push(link)
    byBlock.set(link.noteBlockId, list)
  }

  return (
    <div className="note-source-chips" aria-label="PDF sources">
      {[...byBlock.entries()].map(([blockId, group]) => {
        const box = boxes[blockId]
        if (!box) return null
        return (
          <div key={blockId} className="note-source-chip-stack" style={{ top: box.top, left: box.left }}>
            {group.map((link) => {
              const info = labels[link.id]
              return (
                <button
                  key={link.id}
                  type="button"
                  className={`note-source-chip${info?.missingPdf ? ' is-missing' : ''}`}
                  title={info?.text ?? 'PDF source'}
                  aria-label={info?.missingPdf ? 'PDF unavailable' : `Jump to ${info?.text ?? 'PDF source'}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void PdfNoteLinkEngine.jumpToSource(link)}
                >
                  {info?.text ?? 'Source'}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
