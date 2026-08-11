import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { KIND_META } from '@/services/annotations/kinds'
import { copySelection, extractAndExplain, sendToNotes } from '@/services/notes/extract'
import { useStudyStore } from '@/state/useStudyStore'
import type { AnnotationKind } from '@/types'

/**
 * The PDF selection menu (§D2).
 *
 * Ordered by how often each is actually used during a lesson, not
 * alphabetically. Positioning follows the same rules as the notes format bar:
 * clamp into the visible area on both axes and flip above/below as room allows,
 * so nothing ever escapes off-screen in a narrow reader panel.
 */

const MARGIN = 8

const PRIMARY: { id: string; label: string; run: () => void }[] = []

type Action =
  | { id: 'copy'; label: string; hint?: string }
  | { id: 'send'; label: string; hint?: string }
  | { id: 'snip'; label: string; hint?: string }
  | { id: AnnotationKind; label: string; hint?: string }

const PRIMARY_ACTIONS: Action[] = [
  { id: 'explain', label: 'Explain', hint: 'Ctrl E' },
  { id: 'send', label: 'Send to notes' },
  { id: 'copy', label: 'Copy', hint: 'Ctrl C' },
  { id: 'highlight', label: 'Highlight', hint: 'Ctrl H' },
]

const OVERFLOW_ACTIONS: Action[] = [
  { id: 'benefit', label: 'Fāʾidah', hint: 'Ctrl ⇧ B' },
  { id: 'definition', label: 'Definition', hint: 'Ctrl ⇧ D' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'teacher', label: 'Teacher explanation', hint: 'Ctrl ⇧ T' },
  { id: 'question', label: 'Question', hint: 'Ctrl ⇧ Q' },
  { id: 'reference', label: 'Reference', hint: 'Ctrl ⇧ R' },
  { id: 'important', label: 'Important' },
]

export function SelectionMenu() {
  const selection = useStudyStore((s) => s.selection)
  const setSnipMode = useStudyStore((s) => s.setSnipMode)
  const menuRef = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setMore(false)
    setCopied(false)
  }, [selection])

  useLayoutEffect(() => {
    if (!selection || !menuRef.current) {
      setPos(null)
      return
    }
    const box = menuRef.current.getBoundingClientRect()
    const left = Math.max(
      MARGIN,
      Math.min(selection.menuLeft - box.width / 2, window.innerWidth - box.width - MARGIN),
    )
    const above = selection.menuTop - box.height - 10
    const top =
      above >= MARGIN
        ? above
        : Math.min(selection.menuTop + 26, window.innerHeight - box.height - MARGIN)
    setPos({ left, top: Math.max(MARGIN, top) })
  }, [selection, more])

  if (!selection) return null

  const perform = (action: Action) => {
    if (action.id === 'copy') {
      void copySelection(selection).then((ok) => {
        setCopied(ok)
        if (ok) setTimeout(() => useStudyStore.getState().setSelection(null), 500)
      })
      return
    }
    if (action.id === 'send') {
      void sendToNotes(selection)
      return
    }
    if (action.id === 'snip') {
      useStudyStore.getState().setSelection(null)
      setSnipMode('capture')
      return
    }
    void extractAndExplain(action.id, selection)
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Selection actions"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      className="border-line bg-elevated fixed z-50 flex max-w-[min(30rem,calc(100vw-1rem))] flex-wrap items-center gap-0.5 rounded-md border p-1 shadow-lg"
      onPointerDown={(e) => e.preventDefault()}
    >
      {PRIMARY_ACTIONS.map((action) => (
        <button
          key={action.id}
          onClick={() => perform(action)}
          title={action.hint ? `${action.label} · ${action.hint}` : action.label}
          className="hover:bg-hover text-ink flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-xs whitespace-nowrap"
        >
          {action.id in KIND_META && (
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: `var(--color-hl-${KIND_META[action.id as AnnotationKind].color})` }}
            />
          )}
          {action.id === 'copy' && copied ? 'Copied' : action.label}
        </button>
      ))}

      <span className="bg-line mx-0.5 h-5 w-px shrink-0" />

      <button
        onClick={() => perform({ id: 'snip', label: 'Snip' })}
        title="Snip a region of the page"
        className="hover:bg-hover text-ink flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-xs"
      >
        <span aria-hidden>⛶</span>
        Snip
      </button>

      <button
        onClick={() => setMore((v) => !v)}
        aria-expanded={more}
        className="hover:bg-hover text-ink-muted hover:text-ink h-7 shrink-0 rounded px-2 text-xs"
      >
        More
      </button>

      {more && (
        <div className="border-line bg-elevated absolute end-0 top-full z-10 mt-1 w-56 rounded-md border p-1 shadow-xl">
          {OVERFLOW_ACTIONS.map((action) => (
            <button
              key={action.id}
              onClick={() => perform(action)}
              className="hover:bg-hover text-ink flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-xs"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: `var(--color-hl-${KIND_META[action.id as AnnotationKind].color})` }}
              />
              <span className="flex-1">{action.label}</span>
              {action.hint && <span className="text-ink-faint text-[10px]">{action.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export { PRIMARY }
