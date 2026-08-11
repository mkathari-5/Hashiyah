import { Icon, type IconName } from '@/features/shell/Icon'
import { useAppStore, type LayoutMode } from '@/state/useAppStore'

const LAYOUTS: { mode: LayoutMode; icon: IconName; label: string }[] = [
  { mode: 'three', icon: 'columns', label: 'Library, book and notes  Ctrl+1' },
  { mode: 'study', icon: 'panel-left', label: 'Study — book and notes  Ctrl+2' },
  { mode: 'pdf', icon: 'book', label: 'Book only  Ctrl+3' },
  { mode: 'notes', icon: 'note', label: 'Notes only  Ctrl+4' },
]

export function TopBar({ onImport }: { onImport: () => void }) {
  const resolvedTheme = useAppStore((s) => s.resolvedTheme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen)
  const setSearchOpen = useAppStore((s) => s.setSearchOpen)
  const layout = useAppStore((s) => s.layout)
  const setLayout = useAppStore((s) => s.setLayout)
  const toggleLessonMode = useAppStore((s) => s.toggleLessonMode)

  return (
    <header className="border-line bg-panel flex h-11 shrink-0 items-center gap-2 border-b px-3">
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-accent font-arabic text-lg leading-none" dir="rtl" aria-hidden>
          ح
        </span>
        <span className="text-ink text-[13px] font-semibold tracking-tight">Ḥāshiyah</span>
      </div>

      <button
        onClick={() => setPaletteOpen(true)}
        className="border-line bg-elevated hover:border-line-strong text-ink-faint mx-auto flex h-7 w-full max-w-sm items-center gap-2 rounded border px-2.5 text-xs transition-colors"
      >
        <Icon name="search" className="h-3.5 w-3.5" />
        <span>Search or run a command</span>
        <span className="ms-auto tabular-nums opacity-70">Ctrl K</span>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        <div className="border-line bg-elevated me-1 flex items-center rounded border p-0.5">
          {LAYOUTS.map((entry) => (
            <button
              key={entry.mode}
              onClick={() => setLayout(entry.mode)}
              title={entry.label}
              aria-label={entry.label}
              aria-pressed={layout === entry.mode}
              className={`grid h-6 w-6 place-items-center rounded-[3px] transition-colors ${
                layout === entry.mode
                  ? 'bg-hover text-accent'
                  : 'text-ink-faint hover:text-ink-muted hover:bg-hover'
              }`}
            >
              <Icon name={entry.icon} className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>

        <button
          onClick={toggleLessonMode}
          title="Lesson mode  Ctrl+Shift+L"
          className={`flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors ${
            layout === 'lesson'
              ? 'bg-accent-soft text-accent'
              : 'text-ink-muted hover:bg-hover hover:text-ink'
          }`}
        >
          <Icon name="clock" className="h-3.5 w-3.5" />
          Lesson
        </button>

        <IconButton icon="search" label="Search the library  Ctrl+Shift+F" onClick={() => setSearchOpen(true)} />
        <IconButton icon="import" label="Import a PDF" onClick={onImport} />
        <IconButton
          icon={resolvedTheme === 'dark' ? 'sun' : 'moon'}
          label="Toggle theme  Ctrl+Shift+M"
          onClick={toggleTheme}
        />
      </div>
    </header>
  )
}

function IconButton({
  icon,
  label,
  onClick,
}: {
  icon: IconName
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="hover:bg-hover text-ink-muted hover:text-ink grid h-7 w-7 place-items-center rounded"
    >
      <Icon name={icon} />
    </button>
  )
}
