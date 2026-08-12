import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { booksRepo, subjectsRepo } from '@/db/repos/library'
import { libraryRepo } from '@/db/repos/libraryTree'
import { notesRepo } from '@/db/repos/notes'
import { NodeTitle } from '@/features/library/LibraryTree'
import { NoteEditor, type NoteEditorHandle } from '@/features/notes/NoteEditor'
import { OutlinePopover } from '@/features/notes/OutlinePopover'
import { Icon } from '@/features/shell/Icon'
import { displayTitle } from '@/lib/bookTitle'
import { useAppStore } from '@/state/useAppStore'
import { isRevising, useNotesStore } from '@/state/useNotesStore'
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
  const layout = useAppStore((s) => s.layout)
  const setLayout = useAppStore((s) => s.setLayout)
  const saving = useAppStore((s) => s.saving)
  const savedAt = useAppStore((s) => s.savedAt)
  // Revision belongs to the note being read, so it is asked for by name. The
  // editor records the snapshot on entry and applies it on exit; the panel
  // only flips the mode.
  const revisionMode = useNotesStore((s) => isRevising(s, activeNoteId))
  const setRevisionMode = useNotesStore((s) => s.setRevisionMode)

  const editorRef = useRef<NoteEditorHandle>(null)
  const activeTabRef = useRef<HTMLButtonElement>(null)
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
  /**
   * §F25 — a chapter note's visible identity is the library node's title, not
   * whatever string happens to sit on the note row. Rendering through NodeTitle
   * also keeps mixed English/Arabic titles correctly isolated.
   */
  const libraryOwner = useLiveQuery(
    () => (activeNoteId ? libraryRepo.owner(activeNoteId) : undefined),
    [activeNoteId],
  )
  const noteList = useMemo(() => notes ?? [], [notes])

  useEffect(() => {
    if (revealRequest && revealRequest.noteId !== activeNoteId) setActiveNote(revealRequest.noteId)
  }, [revealRequest, activeNoteId, setActiveNote])

  useEffect(() => {
    if (!activeNoteId && noteList.length) setActiveNote(noteList[0].id)
  }, [activeNoteId, noteList, setActiveNote])

  // A note reached from search or from the library may be off the end of the
  // strip; leaving the reader looking at a tab bar with nothing selected is
  // how a panel starts to feel broken.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeNoteId])

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
      <div className="empty-state">
        <p className="empty-state-line">Open a chapter from the library to start writing.</p>
      </div>
    )
  }

  const active = noteList.find((n) => n.id === activeNoteId)
  const notesFocused = layout === 'notes'

  return (
    <div className="bg-canvas flex h-full min-h-0 flex-col">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      {/* In focus mode the header lines up with the manuscript's measure
          rather than running the full width of the display (§F9). */}
      <header className={`notes-header ${notesFocused ? 'is-focused' : ''}`}>
        <nav className="notes-crumb">
          {subject && (
            <>
              <span className="truncate">{subject.name}</span>
              <span aria-hidden>/</span>
            </>
          )}
          <button onClick={() => setLayout('three')} className="truncate" title="Show the book">
            {displayTitle(book)}
          </button>
        </nav>

        {/**
         * §F10 — the chapter's name is the header. The controls sit on its
         * line and stay quiet, so the panel opens with one clear identity
         * rather than a row of five equally loud buttons.
         */}
        <div className="notes-identity">
          <h2 className="notes-title">
            {libraryOwner ? (
              <NodeTitle node={libraryOwner} className="notes-title-parts" />
            ) : (
              <span dir="auto">{active?.title ?? 'No note yet'}</span>
            )}
          </h2>

          {/* §E30 — revision is a way of reading a chapter, so it sits with
              the document's own controls rather than in the app chrome. While
              it is running the revision bar owns the controls and this would
              only be a second way to say the same thing. */}
          {!revisionMode && (
            <button
              onClick={() => activeNoteId && setRevisionMode(activeNoteId, true)}
              aria-pressed={false}
              title="Revision mode — collapse everything and work through it"
              className="notes-action is-labelled"
            >
              <Icon name="layers" className="h-3 w-3" />
              Revision
            </button>
          )}

          <button
            onClick={() => setOutlineOpen((v) => !v)}
            title="Outline"
            aria-label="Outline"
            className="notes-action"
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
            className="notes-action"
          >
            <Icon name="dots" className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setLayout(notesFocused ? 'three' : 'notes')}
            title={notesFocused ? 'Return to study  Ctrl+1' : 'Focus notes  Ctrl+4'}
            aria-label={notesFocused ? 'Return to study' : 'Focus notes'}
            className="notes-action"
          >
            <Icon name={notesFocused ? 'minimise' : 'maximise'} className="h-3.5 w-3.5" />
          </button>
        </div>

        {/**
         * §25 — tabs across the book's note documents. A chapter usually has
         * exactly one, and a tab strip holding a single tab is chrome that
         * says nothing, so it only appears once there is a choice to make.
         */}
        {noteList.length > 1 && !revisionMode && (
          <div className="notes-tabs scrollbar-none">
            {noteList.map((note) => (
              <button
                key={note.id}
                ref={note.id === activeNoteId ? activeTabRef : undefined}
                onClick={() => setActiveNote(note.id)}
                className={`notes-tab ${note.id === activeNoteId ? 'is-active' : ''}`}
                dir="auto"
              >
                {note.title}
              </button>
            ))}
          </div>
        )}

        {outlineOpen && (
          <OutlinePopover
            entries={outline.length ? outline : (editorRef.current?.outline() ?? [])}
            onJump={(blockId) => editorRef.current?.jumpToBlock(blockId)}
            onClose={() => setOutlineOpen(false)}
          />
        )}

        {menuOpen && (
          <div className="notes-menu" onPointerDown={(e) => e.stopPropagation()}>
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
            <div className="block-menu-sep" />
            {bookId && (
              <MenuItem
                label="New note"
                onClick={() => {
                  setMenuOpen(false)
                  void createNote()
                }}
              />
            )}
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

      {revisionMode && (
        <div className="revision-bar">
          <span className="revision-label">Revision</span>
          <button onClick={() => editorRef.current?.collapseAll(true)}>Collapse all</button>
          <button onClick={() => editorRef.current?.collapseAll(false)}>Expand all</button>
          <button
            className="revision-exit"
            onClick={() => activeNoteId && setRevisionMode(activeNoteId, false)}
          >
            Exit
          </button>
        </div>
      )}

      {/* ── Editor ─────────────────────────────────────────────────────── */}
      {activeNoteId ? (
        <NoteEditor
          key={activeNoteId}
          ref={editorRef}
          noteId={activeNoteId}
          onStats={onStats}
        />
      ) : (
        <div className="empty-state flex-1">
          <p className="empty-state-line">Nothing written about this book yet.</p>
          <p className="empty-state-hint">
            Select a passage in the book and press Ctrl+E, or start a blank note.
          </p>
          <button onClick={createNote} className="empty-state-action">
            New note
          </button>
        </div>
      )}

      {/* ── Status strip ───────────────────────────────────────────────── */}
      {/* The page number lives in the reader and in the status bar already;
          repeating it here was the third copy on one screen. */}
      <footer className="notes-status">
        <span>{saving ? 'Saving…' : savedLabel ? 'Saved' : ''}</span>
        <span className="ms-auto tabular-nums">{words ? `${words} words` : ''}</span>
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
    <button onClick={onClick} className={`block-menu-item ${danger ? 'is-danger' : ''}`}>
      <span className="flex-1">{label}</span>
      {trailing && <span className="block-menu-hint">{trailing}</span>}
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
