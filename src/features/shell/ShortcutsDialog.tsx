import { useEffect, useRef } from 'react'
import { SHORTCUTS } from '@/features/shortcuts/useShortcuts'
import { useAppStore } from '@/state/useAppStore'

export function ShortcutsDialog() {
  const open = useAppStore((s) => s.shortcutsOpen)
  const setOpen = useAppStore((s) => s.setShortcutsOpen)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable.length) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus()
    }
  }, [open, setOpen])

  if (!open) return null

  const groups = SHORTCUTS.reduce<Record<string, typeof SHORTCUTS>>((acc, s) => {
    ;(acc[s.group] ??= []).push(s)
    return acc
  }, {})

  return (
    <div
      className="overlay-veil fixed inset-0 z-[75] grid place-items-center p-6"
      onPointerDown={() => setOpen(false)}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        tabIndex={-1}
        className="ui-dialog w-full max-w-lg p-5 outline-none"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 id="shortcuts-title" className="text-ink mb-4 text-[13.5px] font-semibold">
          Keyboard shortcuts
        </h2>
        <div className="grid gap-5 sm:grid-cols-2">
          {Object.entries(groups).map(([group, items]) => (
            <section key={group}>
              <h3 className="text-ink-faint mb-2 text-[10px] font-medium tracking-wide uppercase">
                {group}
              </h3>
              <ul className="space-y-1.5">
                {items.map((s) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-3">
                    <span className="text-ink-muted text-xs">{s.description}</span>
                    <kbd className="border-line bg-panel text-ink-faint shrink-0 rounded border px-1.5 py-0.5 font-sans text-[10px] whitespace-nowrap">
                      {s.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="text-ink-faint mt-5 text-[11px]">
          On macOS use ⌘ in place of Ctrl. Remappable shortcuts are planned for a later release.
        </p>
      </div>
    </div>
  )
}
