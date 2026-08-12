import { useEffect, useRef } from 'react'
import type { OutlineEntry } from '@/services/notes/NotesService'

/**
 * The notes outline (§17).
 *
 * Deliberately a popover rather than a permanent column: on a panel shared with
 * a book, a standing table of contents costs more width than it earns. It opens
 * from the header, and closes the moment you jump.
 */
export function OutlinePopover({
  entries,
  onJump,
  onClose,
}: {
  entries: OutlineEntry[]
  onJump: (blockId: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div ref={ref} className="outline-pop">
      <div className="block-menu-group">Outline</div>
      {entries.length === 0 ? (
        <p className="outline-pop-empty">
          No headings yet. Use <span className="text-ink-muted">/heading</span> to structure a long
          lesson.
        </p>
      ) : (
        entries.map((entry, i) => (
          <button
            key={`${entry.blockId}:${i}`}
            onClick={() => {
              onJump(entry.blockId)
              onClose()
            }}
            className={`outline-pop-item ${entry.kind === 'heading' ? 'is-heading' : ''}`}
            style={{ paddingInlineStart: `${0.45 + (entry.level - 1) * 0.7}rem` }}
            dir="auto"
            title={entry.text}
          >
            {entry.kind === 'toggle' && (
              <span className="lib-outline-mark" aria-hidden>
                ▸
              </span>
            )}
            <span className="truncate">{entry.text}</span>
          </button>
        ))
      )}
    </div>
  )
}
