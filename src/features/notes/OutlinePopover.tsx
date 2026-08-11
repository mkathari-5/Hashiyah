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
    <div
      ref={ref}
      className="border-line bg-elevated absolute end-2 top-10 z-40 max-h-80 w-64 overflow-y-auto rounded-md border p-1 shadow-xl"
    >
      <div className="text-ink-faint px-2 pt-1.5 pb-1 text-[9.5px] font-semibold tracking-wider uppercase">
        Outline
      </div>
      {entries.length === 0 ? (
        <p className="text-ink-faint px-2 py-3 text-xs">
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
            className="hover:bg-hover text-ink-muted hover:text-ink block w-full truncate rounded px-2 py-1 text-start text-[12.5px]"
            style={{ paddingInlineStart: `${0.5 + (entry.level - 1) * 0.75}rem` }}
            dir="auto"
          >
            {entry.text}
          </button>
        ))
      )}
    </div>
  )
}
