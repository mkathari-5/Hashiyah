import { SHORTCUTS } from '@/features/shortcuts/useShortcuts'
import { useAppStore } from '@/state/useAppStore'

export function ShortcutsDialog() {
  const open = useAppStore((s) => s.shortcutsOpen)
  const setOpen = useAppStore((s) => s.setShortcutsOpen)
  if (!open) return null

  const groups = SHORTCUTS.reduce<Record<string, typeof SHORTCUTS>>((acc, s) => {
    ;(acc[s.group] ??= []).push(s)
    return acc
  }, {})

  return (
    <div
      className="fixed inset-0 z-[75] grid place-items-center bg-black/45 p-6"
      onPointerDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="border-line bg-elevated w-full max-w-lg rounded-lg border p-5 shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-ink mb-4 text-sm font-semibold">Keyboard shortcuts</h2>
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
