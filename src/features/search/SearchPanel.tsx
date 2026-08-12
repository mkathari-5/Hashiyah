import { useEffect, useMemo, useRef, useState } from 'react'
import { search, type SearchHit, type SearchResults, type SearchScope } from '@/services/search/SearchEngine'
import { useAppStore } from '@/state/useAppStore'
import { useLibraryStore } from '@/state/useLibraryStore'
import { useNotesStore } from '@/state/useNotesStore'
import { useStudyStore } from '@/state/useStudyStore'
import { Icon } from '@/features/shell/Icon'

const EMPTY: SearchResults = {
  query: '',
  library: [],
  outline: [],
  books: [],
  pages: [],
  notes: [],
  annotations: [],
  total: 0,
  truncated: false,
}

export function SearchPanel() {
  const open = useAppStore((s) => s.searchOpen)
  const setOpen = useAppStore((s) => s.setSearchOpen)
  const bookId = useStudyStore((s) => s.bookId)
  const documentId = useStudyStore((s) => s.documentId)
  const openBook = useStudyStore((s) => s.openBook)
  const setPage = useStudyStore((s) => s.setPage)
  const requestJump = useStudyStore((s) => s.requestJump)
  const setActiveNote = useStudyStore((s) => s.setActiveNote)
  const openNode = useLibraryStore((s) => s.openNode)
  const requestScrollTo = useNotesStore((s) => s.requestScrollTo)

  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<SearchScope>('book')
  const [results, setResults] = useState<SearchResults>(EMPTY)
  const [running, setRunning] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const runId = useRef(0)

  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [open])

  useEffect(() => {
    if (!bookId) setScope('library')
  }, [bookId])

  useEffect(() => {
    if (!open) return
    const id = ++runId.current
    if (query.trim().length < 2) {
      setResults(EMPTY)
      setRunning(false)
      return
    }
    setRunning(true)
    const timer = window.setTimeout(() => {
      void search(query, scope, { bookId, documentId }).then((r) => {
        if (runId.current === id) {
          setResults(r)
          setRunning(false)
        }
      })
    }, 160)
    return () => window.clearTimeout(timer)
  }, [query, scope, bookId, documentId, open])

  const groups = useMemo(
    () =>
      [
        // Notes first: searching a term you studied usually means "where did I
        // write about this?", not "where does the word appear in a PDF?".
        { title: 'In my chapters', hits: results.outline },
        { title: 'Library', hits: results.library },
        { title: 'My notes', hits: results.notes },
        { title: 'Books', hits: results.books },
        { title: 'Book text', hits: results.pages },
        { title: 'Highlights', hits: results.annotations },
      ].filter((g) => g.hits.length > 0),
    [results],
  )

  if (!open) return null

  const activate = async (hit: SearchHit) => {
    // A library or outline result names the node, so opening it restores the
    // whole context — book, chapter notes, sidebar selection — in one step.
    if (hit.nodeId) {
      await openNode(hit.nodeId)
      if (hit.blockId && hit.noteId) {
        // The editor may still be loading; the request carries its note id and
        // is consumed once that document is in place.
        requestScrollTo(hit.noteId, hit.blockId)
      }
      setOpen(false)
      return
    }

    if (hit.bookId && hit.bookId !== bookId) await openBook(hit.bookId)
    if (hit.kind === 'page' && hit.pageNumber) setPage(hit.pageNumber)
    if (hit.kind === 'annotation' && hit.annotationId) requestJump(hit.annotationId)
    if (hit.kind === 'note' && hit.noteId) setActiveNote(hit.noteId)
    setOpen(false)
  }

  return (
    <div
      className="search-scrim"
      onPointerDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Search"
        className="search-panel"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="search-field">
          <Icon name="search" className="text-ink-faint h-3.5 w-3.5" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            placeholder="Search books, notes and highlights…"
            className="search-input"
          />
          <div className="search-scope">
            <ScopeButton active={scope === 'book'} disabled={!bookId} onClick={() => setScope('book')}>
              This book
            </ScopeButton>
            <ScopeButton active={scope === 'library'} onClick={() => setScope('library')}>
              Library
            </ScopeButton>
          </div>
        </div>

        <div className="search-results">
          {query.trim().length < 2 ? (
            <p className="search-note">
              Type at least two characters. Diacritics are ignored — الحنيفية finds ٱلْحَنِيفِيَّة.
            </p>
          ) : running && results.total === 0 ? (
            <p className="search-note">Searching…</p>
          ) : results.total === 0 ? (
            <p className="search-note">No matches.</p>
          ) : (
            groups.map((group) => (
              <section key={group.title} className="search-group">
                <h3 className="search-group-title">
                  {group.title}
                  <span className="search-count">{group.hits.length}</span>
                </h3>
                {group.hits.map((hit) => (
                  <button key={hit.id} onClick={() => void activate(hit)} className="search-hit">
                    {/* A chapter result reads best as its path, so you can see
                        which book and bāb it came from. */}
                    <div className="search-hit-path">
                      <span className="truncate" dir="auto">
                        {hit.path || hit.bookTitle}
                      </span>
                      {hit.pageNumber && <span className="tabular-nums">· p. {hit.pageNumber}</span>}
                    </div>
                    <p
                      dir={hit.rtl ? 'rtl' : 'ltr'}
                      className={`search-hit-text ${hit.rtl ? 'font-arabic' : ''}`}
                    >
                      {hit.snippet.slice(0, hit.matchStart)}
                      <mark>{hit.snippet.slice(hit.matchStart, hit.matchEnd)}</mark>
                      {hit.snippet.slice(hit.matchEnd)}
                    </p>
                  </button>
                ))}
              </section>
            ))
          )}
          {results.truncated && (
            <p className="search-note">
              Showing the first matches only — narrow the query for more.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function ScopeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`search-scope-button ${active ? 'is-active' : ''}`}
    >
      {children}
    </button>
  )
}
