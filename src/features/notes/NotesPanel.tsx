import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { booksRepo, subjectsRepo } from '@/db/repos/library'
import { notesRepo } from '@/db/repos/notes'
import { NoteEditor, type NoteEditorHandle } from '@/features/notes/NoteEditor'
import { OutlinePopover } from '@/features/notes/OutlinePopover'
import { Icon } from '@/features/shell/Icon'
import { displayTitle } from '@/lib/bookTitle'
import { useAppStore } from '@/state/useAppStore'
import { useStudyStore } from '@/state/useStudyStore'
import type { OutlineEntry } from '@/services/notes/NotesService'
import type { Note } from '@/types'

/**
 * The notes panel (§4).
 *
 * Three bands: a compact identity header, the editor, and a quiet status strip.
 * The header carries the note's identity — breadcrumb, title, tabs — because a
 * study document that opens straight into body text has no sense of place (§23).
 */
export function NotesPanel() {
  const bookId = useStudyStore((s) => s.bookId)
  const activeNoteId = useStudyStore((s) => s.activeNoteId)
  const setActiveNote = useStudyStore((s) => s.setActiveNote)
  const revealRequest = useStudyStore((s) => s.revealRequest)
  const currentPage = useStudyStore((s) => s.currentPage)
  const layout = useAppStore((s) => s.layout)
  const setLayout = useAppStore((s) => s.setLayout)
  const saving = useAppStore((s) => s.saving)
  const savedAt = useAppStore((s) => s.savedAt)

  const editorRef = useRef<NoteEditorHandle>(null)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outline, setOutline] = useState<OutlineEntry[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [words, setWords] = useState(0)
  const [savedLabel, setSavedLabel] = useState(false)

  /**
   * The book's notes, plus the active one even when it belongs to no book.
   * §E14 — "Questions to ask Ustādh" and a weekly timetable are notes-only
   * library items; refusing to show them because no PDF is open would make
   * whole sections of the library unreachable.
   */
  const notes = useLiveQuery(async () => {
    const forBook = bookId ? await notesRepo.forBook(bookId) : []
    if (!activeNoteId || forBook.some((n) => n.id === activeNoteId)) return forBook
    const active = await notesRepo.get(activeNoteId)
    return active ? [active, ...forBook] : forBook
  }, [bookId, activeNoteId]) as Note[] | undefined
  const book = useLiveQuery(() => (bookId ? booksRepo.get(bookId) : undefined), [bookId])
  const subject = useLiveQuery(
    async () => (book?.subjectId ? (await subjectsRepo.all()).find((s) => s.id === book.subjectId) : undefined),
    [book?.subjectId],
  )
  const noteList = useMemo(() => notes ?? [], [notes])

  useEffect(() => {
    if (revealRequest && revealRequest.noteId !== activeNoteId) setActiveNote(revealRequest.noteId)
  }, [revealRequest, activeNoteId, setActiveNote])

  useEffect(() => {
    if (!activeNoteId && noteList.length) setActiveNote(noteList[0].id)
  }, [activeNoteId, noteList, setActiveNote])

  useEffect(() => {
    if (!savedAt) return
    setSavedLabel(true)
    const timer = setTimeout(() => setSavedLabel(false), 1600)
    return () => clearTimeout(timer)
  }, [savedAt])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = () => setMenuOpen(false)
    const timer = setTimeout(() => document.addEventListener('pointerdown', onDown), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [menuOpen])

  const createNote = useCallback(async () => {
    if (!bookId) return
    const note = await notesRepo.create({
      bookId,
      title: noteList.length ? `Note ${noteList.length + 1}` : `${displayTitle(book)} — notes`,
    })
    setActiveNote(note.id)
  }, [bookId, book, noteList.length, setActiveNote])

  const onStats = useCallback((stats: { words: number }) => setWords(stats.words), [])

  // Only truly empty when there is neither a book nor a notes-only item open.
  if (!bookId && !activeNoteId) {
    return (
      <div className="text-ink-faint grid h-full place-items-center px-6 text-center text-xs">
        Open something from the library to start writing.
      </div>
    )
  }

  const active = noteList.find((n) => n.id === activeNoteId)
  const notesFocused = layout === 'notes'

  return (
    <div className="bg-canvas flex h-full min-h-0 flex-col">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="border-line bg-panel relative shrink-0 border-b">
        <div className="flex items-center gap-1 px-2.5 pt-1.5">
          <nav className="text-ink-faint flex min-w-0 flex-1 items-center gap-1 text-[10.5px]">
            {subject && (
              <>
                <span className="truncate">{subject.name}</span>
                <span aria-hidden>/</span>
              </>
            )}
            <button
              onClick={() => setLayout('three')}
              className="hover:text-ink-muted truncate transition-colors"
              title="Show the book"
            >
              {displayTitle(book)}
            </button>
          </nav>

          <button
            onClick={() => setOutlineOpen((v) => !v)}
            title="Outline"
            aria-label="Outline"
            className="hover:bg-hover text-ink-faint hover:text-ink-muted grid h-6 w-6 place-items-center rounded"
          >
            <Icon name="list" className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((v) => !v)
            }}
            title="Document options"
            aria-label="Document options"
            className="hover:bg-hover text-ink-faint hover:text-ink-muted grid h-6 w-6 place-items-center rounded"
          >
            <Icon name="dots" className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setLayout(notesFocused ? 'three' : 'notes')}
            title={notesFocused ? 'Return to study  Ctrl+3' : 'Focus notes  Ctrl+3'}
            aria-label={notesFocused ? 'Return to study' : 'Focus notes'}
            className="hover:bg-hover text-ink-faint hover:text-ink-muted grid h-6 w-6 place-items-center rounded"
          >
            <Icon name={notesFocused ? 'minimise' : 'maximise'} className="h-3.5 w-3.5" />
          </button>
        </div>

        <h2 className="text-ink truncate px-2.5 pt-0.5 pb-1 text-[15px] font-semibold" dir="auto">
          {active?.title ?? 'No note yet'}
        </h2>

        {/* §25 — tabs across the book's note documents. */}
        <div className="scrollbar-none flex items-center gap-0.5 overflow-x-auto px-1.5 pb-1">
          {noteList.map((note) => (
            <button
              key={note.id}
              onClick={() => setActiveNote(note.id)}
              className={`max-w-[11rem] shrink-0 truncate rounded px-2 py-1 text-[11.5px] transition-colors ${
                note.id === activeNoteId
                  ? 'bg-hover text-ink'
                  : 'text-ink-faint hover:text-ink-muted hover:bg-hover/60'
              }`}
              dir="auto"
            >
              {note.title}
            </button>
          ))}
          <button
            onClick={createNote}
            title="New note"
            aria-label="New note"
            className="hover:bg-hover text-ink-faint hover:text-ink-muted grid h-6 w-6 shrink-0 place-items-center rounded"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
          </button>
        </div>

        {outlineOpen && (
          <OutlinePopover
            entries={outline.length ? outline : (editorRef.current?.outline() ?? [])}
            onJump={(blockId) => editorRef.current?.jumpToBlock(blockId)}
            onClose={() => setOutlineOpen(false)}
          />
        )}

        {menuOpen && (
          <div
            className="border-line bg-elevated absolute end-2 top-10 z-40 w-52 rounded-md border p-1 shadow-xl"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <MenuItem
              label="Collapse all toggles"
              onClick={() => {
                editorRef.current?.collapseAll(true)
                setMenuOpen(false)
              }}
            />
            <MenuItem
              label="Expand all toggles"
              onClick={() => {
                editorRef.current?.collapseAll(false)
                setMenuOpen(false)
              }}
            />
            <MenuItem
              label="Find in note"
              trailing="Ctrl F"
              onClick={() => {
                editorRef.current?.openFind()
                setMenuOpen(false)
              }}
            />
            <div className="bg-line my-1 h-px" />
            <MenuItem
              label="Rename note"
              onClick={async () => {
                setMenuOpen(false)
                if (!active) return
                const next = window.prompt('Note title', active.title)?.trim()
                if (next) await notesRepo.update(active.id, { title: next })
              }}
            />
            <MenuItem
              label="Delete note"
              danger
              onClick={async () => {
                setMenuOpen(false)
                if (!active) return
                if (!window.confirm(`Delete “${active.title}”? This cannot be undone.`)) return
                await notesRepo.remove(active.id)
                setActiveNote(null)
              }}
            />
          </div>
        )}
      </header>

      {/* ── Editor ─────────────────────────────────────────────────────── */}
      {activeNoteId ? (
        <NoteEditor
          key={activeNoteId}
          ref={editorRef}
          noteId={activeNoteId}
          onStats={onStats}
        />
      ) : (
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div>
            <p className="text-ink-muted text-sm">Nothing written about this book yet.</p>
            <p className="text-ink-faint mt-2 text-xs">
              Select a passage and press Ctrl+E, or start a blank note.
            </p>
            <button
              onClick={createNote}
              className="border-line hover:bg-hover text-ink-muted mt-4 rounded border px-3 py-1.5 text-xs"
            >
              New note
            </button>
          </div>
        </div>
      )}

      {/* ── Status strip ───────────────────────────────────────────────── */}
      <footer className="border-line bg-panel text-ink-faint flex h-6 shrink-0 items-center gap-3 border-t px-3 text-[10.5px]">
        <span className="min-w-12">{saving ? 'Saving…' : savedLabel ? 'Saved ✓' : ''}</span>
        <span className="ms-auto tabular-nums">{words} words</span>
        <span className="tabular-nums">p. {currentPage}</span>
      </footer>

      <OutlineSync editorRef={editorRef} open={outlineOpen} onOutline={setOutline} />
    </div>
  )
}

function MenuItem({
  label,
  onClick,
  trailing,
  danger,
}: {
  label: string
  onClick: () => void
  trailing?: string
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`hover:bg-hover flex w-full items-center rounded px-2 py-1.5 text-start text-xs ${
        danger ? 'text-ink-muted hover:text-hl-rose' : 'text-ink-muted'
      }`}
    >
      <span className="flex-1">{label}</span>
      {trailing && <span className="text-ink-faint text-[10px]">{trailing}</span>}
    </button>
  )
}

/** Reads the outline only while the popover is open — no cost while typing. */
function OutlineSync({
  editorRef,
  open,
  onOutline,
}: {
  editorRef: React.RefObject<NoteEditorHandle | null>
  open: boolean
  onOutline: (entries: OutlineEntry[]) => void
}) {
  useEffect(() => {
    if (!open) return
    onOutline(editorRef.current?.outline() ?? [])
  }, [open, editorRef, onOutline])
  return null
}

// Re-exported so the panel owns the type surface its consumers need.
export type { OutlineEntry }
