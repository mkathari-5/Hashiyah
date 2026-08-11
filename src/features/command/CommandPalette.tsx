import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { booksRepo } from '@/db/repos/library'
import { notesRepo } from '@/db/repos/notes'
import { normalizeForSearch } from '@/lib/arabic'
import { quickNoteAtCurrentPosition } from '@/services/notes/extract'
import { exportNote } from '@/services/export/ExportEngine'
import { useAppStore } from '@/state/useAppStore'
import { useStudyStore } from '@/state/useStudyStore'
import { Icon, type IconName } from '@/features/shell/Icon'

interface Command {
  id: string
  title: string
  hint?: string
  group: string
  icon: IconName
  run: () => void | Promise<void>
}

export function CommandPalette({ onImport }: { onImport: () => void }) {
  const open = useAppStore((s) => s.paletteOpen)
  const setOpen = useAppStore((s) => s.setPaletteOpen)
  const setSearchOpen = useAppStore((s) => s.setSearchOpen)
  const setShortcutsOpen = useAppStore((s) => s.setShortcutsOpen)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const setTheme = useAppStore((s) => s.setTheme)
  const setLayout = useAppStore((s) => s.setLayout)
  const resetSizes = useAppStore((s) => s.resetSizes)
  const toggleLessonMode = useAppStore((s) => s.toggleLessonMode)

  const bookId = useStudyStore((s) => s.bookId)
  const activeNoteId = useStudyStore((s) => s.activeNoteId)
  const pageCount = useStudyStore((s) => s.pageCount)
  const openBook = useStudyStore((s) => s.openBook)
  const setPage = useStudyStore((s) => s.setPage)
  const setActiveNote = useStudyStore((s) => s.setActiveNote)

  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const books = useLiveQuery(() => booksRepo.all(), [], [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
      queueMicrotask(() => inputRef.current?.focus())
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const close = (fn: () => void | Promise<void>) => async () => {
      setOpen(false)
      await fn()
    }

    const actions: Command[] = [
      {
        id: 'search',
        title: 'Search library',
        hint: 'Ctrl+Shift+F',
        group: 'Actions',
        icon: 'search',
        run: close(() => setSearchOpen(true)),
      },
      { id: 'import', title: 'Import a PDF', group: 'Actions', icon: 'import', run: close(onImport) },
      {
        id: 'lesson',
        title: 'Toggle Lesson Mode',
        hint: 'Ctrl+Shift+L',
        group: 'Layout',
        icon: 'clock',
        run: close(toggleLessonMode),
      },
      { id: 'layout-three', title: 'Library, book and notes', hint: 'Ctrl+1', group: 'Layout', icon: 'columns', run: close(() => setLayout('three')) },
      { id: 'layout-study', title: 'Study — book and notes', hint: 'Ctrl+2', group: 'Layout', icon: 'panel-left', run: close(() => setLayout('study')) },
      { id: 'layout-pdf', title: 'Focus the book', hint: 'Ctrl+3', group: 'Layout', icon: 'book', run: close(() => setLayout('pdf')) },
      { id: 'layout-notes', title: 'Focus notes', hint: 'Ctrl+4', group: 'Layout', icon: 'note', run: close(() => setLayout('notes')) },
      { id: 'reset-panels', title: 'Restore panel widths', group: 'Layout', icon: 'columns', run: close(resetSizes) },
      { id: 'theme-dark', title: 'Theme — dark', group: 'Layout', icon: 'moon', run: close(() => setTheme('dark')) },
      { id: 'theme-light', title: 'Theme — light', group: 'Layout', icon: 'sun', run: close(() => setTheme('light')) },
      { id: 'theme-system', title: 'Theme — follow system', group: 'Layout', icon: 'settings', run: close(() => setTheme('system')) },
      { id: 'theme', title: 'Toggle dark / light theme', hint: 'Ctrl+Shift+M', group: 'Layout', icon: 'moon', run: close(toggleTheme) },
      {
        id: 'shortcuts',
        title: 'Keyboard shortcuts',
        group: 'Actions',
        icon: 'keyboard',
        run: close(() => setShortcutsOpen(true)),
      },
    ]

    if (bookId) {
      actions.push(
        {
          id: 'new-note',
          title: 'New note in this book',
          group: 'Actions',
          icon: 'note',
          run: close(async () => {
            const note = await notesRepo.create({ bookId, title: 'Untitled note' })
            setActiveNote(note.id)
          }),
        },
        {
          id: 'quick-note',
          title: 'Note at my current position',
          hint: 'Ctrl+Shift+N',
          group: 'Actions',
          icon: 'quote',
          run: close(() => quickNoteAtCurrentPosition()),
        },
      )
    }

    if (activeNoteId) {
      actions.push({
        id: 'export-note',
        title: 'Export this note as Markdown',
        group: 'Actions',
        icon: 'file',
        run: close(() => exportNote(activeNoteId)),
      })
    }

    const bookCommands: Command[] = books.map((b) => ({
      id: `book:${b.id}`,
      title: b.title,
      hint: b.arabicTitle,
      group: 'Open book',
      icon: 'book',
      run: close(() => openBook(b.id)),
    }))

    return [...actions, ...bookCommands]
  }, [
    books,
    bookId,
    activeNoteId,
    onImport,
    openBook,
    resetSizes,
    setActiveNote,
    setLayout,
    setOpen,
    setSearchOpen,
    setShortcutsOpen,
    setTheme,
    toggleLessonMode,
    toggleTheme,
  ])

  const pageJump = useMemo<Command | null>(() => {
    const match = /^(?:p|page)?\s*(\d{1,5})$/i.exec(query.trim())
    if (!match || !bookId) return null
    const page = Number(match[1])
    if (page < 1 || page > pageCount) return null
    return {
      id: 'goto-page',
      title: `Go to page ${page}`,
      group: 'Navigate',
      icon: 'chevrons-right',
      run: () => {
        setOpen(false)
        setPage(page)
      },
    }
  }, [query, bookId, pageCount, setOpen, setPage])

  const filtered = useMemo(() => {
    const q = normalizeForSearch(query)
    const base = q
      ? commands.filter(
          (c) => normalizeForSearch(c.title).includes(q) || (c.hint && normalizeForSearch(c.hint).includes(q)),
        )
      : commands
    return (pageJump ? [pageJump, ...base] : base).slice(0, 40)
  }, [commands, query, pageJump])

  useEffect(() => setIndex(0), [query])

  if (!open) return null

  const grouped = filtered.reduce<Record<string, Command[]>>((acc, c) => {
    ;(acc[c.group] ??= []).push(c)
    return acc
  }, {})

  let running = -1

  return (
    <div
      className="fixed inset-0 z-[75] flex items-start justify-center bg-black/40 p-6 pt-[12vh]"
      onPointerDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="border-line bg-elevated flex max-h-[62vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => (i + 1) % Math.max(1, filtered.length))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              void filtered[index]?.run()
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
          placeholder="Run a command, open a book, or type a page number…"
          className="border-line text-ink placeholder:text-ink-faint border-b bg-transparent px-4 py-3 text-sm outline-none"
        />

        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {filtered.length === 0 && (
            <p className="text-ink-faint px-3 py-6 text-center text-xs">No matching command.</p>
          )}
          {Object.entries(grouped).map(([group, items]) => (
            <section key={group}>
              <h3 className="text-ink-faint px-3 pt-2 pb-1 text-[10px] font-medium tracking-wide uppercase">
                {group}
              </h3>
              {items.map((command) => {
                running += 1
                const selected = running === index
                return (
                  <button
                    key={command.id}
                    onMouseEnter={() => setIndex(filtered.indexOf(command))}
                    onClick={() => void command.run()}
                    className={`flex w-full items-center gap-2.5 rounded px-3 py-1.5 text-start text-[13px] ${
                      selected ? 'bg-hover text-ink' : 'text-ink-muted'
                    }`}
                  >
                    <Icon name={command.icon} className="text-ink-faint h-3.5 w-3.5" />
                    <span className="truncate">{command.title}</span>
                    {command.hint && (
                      <span className="text-ink-faint ms-auto ps-2 text-[11px]">{command.hint}</span>
                    )}
                  </button>
                )
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
