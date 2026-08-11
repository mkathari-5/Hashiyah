import { useEffect, useMemo, useRef, useState } from 'react'
import { search, type SearchHit, type SearchResults, type SearchScope } from '@/services/search/SearchEngine'
import { useAppStore } from '@/state/useAppStore'
import { useStudyStore } from '@/state/useStudyStore'
import { Icon } from '@/features/shell/Icon'

const EMPTY: SearchResults = {
  query: '',
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
        { title: 'Books', hits: results.books },
        { title: 'Book text', hits: results.pages },
        { title: 'My notes', hits: results.notes },
        { title: 'Highlights', hits: results.annotations },
      ].filter((g) => g.hits.length > 0),
    [results],
  )

  if (!open) return null

  const activate = async (hit: SearchHit) => {
    if (hit.bookId && hit.bookId !== bookId) await openBook(hit.bookId)
    if (hit.kind === 'page' && hit.pageNumber) setPage(hit.pageNumber)
    if (hit.kind === 'annotation' && hit.annotationId) requestJump(hit.annotationId)
    if (hit.kind === 'note' && hit.noteId) setActiveNote(hit.noteId)
    setOpen(false)
  }

  return (
    <div
      className="fixed inset-0 z-[65] flex items-start justify-center bg-black/40 p-6 pt-[10vh]"
      onPointerDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Search"
        className="border-line bg-elevated flex max-h-[72vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="border-line flex items-center gap-2 border-b px-3 py-2.5">
          <Icon name="search" className="text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            placeholder="Search books, notes and highlights…"
            className="text-ink placeholder:text-ink-faint flex-1 bg-transparent text-sm outline-none"
          />
          <div className="border-line flex overflow-hidden rounded border text-[11px]">
            <ScopeButton active={scope === 'book'} disabled={!bookId} onClick={() => setScope('book')}>
              This book
            </ScopeButton>
            <ScopeButton active={scope === 'library'} onClick={() => setScope('library')}>
              Library
            </ScopeButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {query.trim().length < 2 ? (
            <p className="text-ink-faint px-3 py-6 text-center text-xs">
              Type at least two characters. Diacritics are ignored — الحنيفية finds ٱلْحَنِيفِيَّة.
            </p>
          ) : running && results.total === 0 ? (
            <p className="text-ink-faint px-3 py-6 text-center text-xs">Searching…</p>
          ) : results.total === 0 ? (
            <p className="text-ink-faint px-3 py-6 text-center text-xs">No matches.</p>
          ) : (
            groups.map((group) => (
              <section key={group.title} className="mb-2">
                <h3 className="text-ink-faint px-2 pt-2 pb-1 text-[10px] font-medium tracking-wide uppercase">
                  {group.title} · {group.hits.length}
                </h3>
                {group.hits.map((hit) => (
                  <button
                    key={hit.id}
                    onClick={() => void activate(hit)}
                    className="hover:bg-hover block w-full rounded px-2 py-1.5 text-start"
                  >
                    <div className="text-ink-faint flex items-center gap-1.5 text-[10.5px]">
                      <span className="truncate">{hit.bookTitle}</span>
                      {hit.pageNumber && <span className="tabular-nums">· p. {hit.pageNumber}</span>}
                    </div>
                    <p
                      dir={hit.rtl ? 'rtl' : 'ltr'}
                      className={`text-ink mt-0.5 line-clamp-2 text-[12.5px] ${hit.rtl ? 'font-arabic' : ''}`}
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
            <p className="text-ink-faint px-3 py-2 text-center text-[11px]">
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
      className={`px-2 py-1 ${active ? 'bg-hover text-ink' : 'text-ink-muted'} disabled:opacity-40`}
    >
      {children}
    </button>
  )
}
