import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { booksRepo, subjectsRepo } from '@/db/repos/library'
import { Icon } from '@/features/shell/Icon'
import { normalizeForSearch } from '@/lib/arabic'
import { displayTitle, secondaryTitle } from '@/lib/bookTitle'
import { useStudyStore } from '@/state/useStudyStore'
import type { Book, Subject } from '@/types'

interface Props {
  onImport: () => void
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-1.5">
      <h3 className="text-ink-faint px-2 pt-1.5 pb-1 text-[10px] font-medium tracking-wide uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

export function LibraryPanel({ onImport }: Props) {
  const subjects = useLiveQuery(() => subjectsRepo.all(), [], [])
  const books = useLiveQuery(() => booksRepo.all(), [], [])
  const recent = useLiveQuery(() => booksRepo.recent(4), [], [])
  const openBook = useStudyStore((s) => s.openBook)
  const activeBookId = useStudyStore((s) => s.bookId)
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const normalizedFilter = normalizeForSearch(filter)

  const matches = useMemo(() => {
    if (!normalizedFilter) return null
    return new Set(
      books
        .filter((b) =>
          [b.title, b.arabicTitle, b.author, b.arabicAuthor]
            .filter(Boolean)
            .some((v) => normalizeForSearch(v!).includes(normalizedFilter)),
        )
        .map((b) => b.id),
    )
  }, [books, normalizedFilter])

  const childSubjects = (parentId: string | null) =>
    subjects.filter((s) => s.parentId === parentId).sort((a, b) => a.order - b.order)
  const booksIn = (subjectId: string | null) =>
    books
      .filter((b) => b.subjectId === subjectId)
      .filter((b) => !matches || matches.has(b.id))
      .sort((a, b) => a.order - b.order)

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const addSubject = async () => {
    const name = window.prompt('Subject name (e.g. ʿAqīdah, Fiqh, Ḥadīth)')?.trim()
    if (name) await subjectsRepo.create({ name })
  }

  const moveBook = async (bookId: string, subjectId: string | null) => {
    await booksRepo.update(bookId, { subjectId })
  }

  const renderSubject = (subject: Subject, depth: number) => {
    const kids = childSubjects(subject.id)
    const own = booksIn(subject.id)
    // While filtering, hide branches with nothing in them.
    if (matches && own.length === 0 && kids.every((k) => !hasMatches(k.id))) return null
    const isCollapsed = collapsed.has(subject.id) && !matches

    return (
      <li key={subject.id}>
        <div
          className="hover:bg-hover group flex items-center gap-1 rounded px-1 py-[3px]"
          style={{ paddingInlineStart: depth * 12 + 4 }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const id = e.dataTransfer.getData('text/hashiyah-book')
            if (id) void moveBook(id, subject.id)
          }}
        >
          <button
            onClick={() => toggle(subject.id)}
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            className="text-ink-faint grid h-4 w-4 place-items-center"
          >
            <Icon
              name="chevron-right"
              className={`h-3 w-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
            />
          </button>
          <span className="text-ink-muted truncate text-[12.5px] font-medium" dir="auto">
            {subject.name}
          </span>
          <span className="text-ink-faint ms-auto pe-1 text-[10px] opacity-0 group-hover:opacity-100">
            {own.length || ''}
          </span>
        </div>

        {!isCollapsed && (
          <ul>
            {kids.map((k) => renderSubject(k, depth + 1))}
            {own.map((b) => renderBook(b, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  const hasMatches = (subjectId: string): boolean =>
    booksIn(subjectId).length > 0 || childSubjects(subjectId).some((s) => hasMatches(s.id))

  const renderBook = (book: Book, depth: number, key?: string) => (
    <li key={key ?? book.id}>
      <button
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/hashiyah-book', book.id)}
        onClick={() => void openBook(book.id)}
        onDoubleClick={() => void booksRepo.update(book.id, { favorite: !book.favorite })}
        title={secondaryTitle(book) ?? undefined}
        style={{ paddingInlineStart: depth * 12 + 22 }}
        className={`hover:bg-hover group/book flex w-full items-center gap-1.5 rounded py-[3px] pe-2 text-start ${
          activeBookId === book.id ? 'bg-hover text-accent' : 'text-ink'
        }`}
      >
        <Icon name="book" className="text-ink-faint h-3.5 w-3.5" />
        {/* §45 — the reader's name for the book, never the PDF filename. */}
        <span className="truncate text-[12.5px]" dir="auto">
          {displayTitle(book)}
        </span>
        {book.favorite && <Icon name="star" className="text-accent ms-auto h-3 w-3 shrink-0" />}
      </button>
    </li>
  )

  const loose = booksIn(null)
  const favourites = books.filter((b) => b.favorite).filter((b) => !matches || matches.has(b.id))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-line flex h-11 shrink-0 items-center gap-1 border-b px-2">
        <span className="text-ink-muted flex-1 ps-1 text-[11px] font-semibold tracking-wide uppercase">
          Library
        </span>
        <button
          onClick={addSubject}
          title="New subject"
          aria-label="New subject"
          className="hover:bg-hover text-ink-muted hover:text-ink grid h-7 w-7 place-items-center rounded"
        >
          <Icon name="folder" />
        </button>
        <button
          onClick={onImport}
          title="Import a PDF"
          aria-label="Import a PDF"
          className="hover:bg-hover text-ink-muted hover:text-ink grid h-7 w-7 place-items-center rounded"
        >
          <Icon name="import" />
        </button>
      </div>

      <div className="px-2 pt-2 pb-1">
        <div className="border-line bg-elevated flex items-center gap-1.5 rounded px-2 py-1">
          <Icon name="search" className="text-ink-faint h-3.5 w-3.5" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter books"
            aria-label="Filter books"
            className="text-ink placeholder:text-ink-faint w-full bg-transparent text-[12.5px] outline-none"
          />
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-1 pb-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const id = e.dataTransfer.getData('text/hashiyah-book')
          if (id) void moveBook(id, null)
        }}
      >
        {/* §44 — Recent, Favourites, then the hierarchy itself. */}
        {recent.length > 0 && !filter && (
          <Section title="Recent">
            <ul>{recent.map((b) => renderBook(b, 0, `recent:${b.id}`))}</ul>
          </Section>
        )}

        {favourites.length > 0 && !filter && (
          <Section title="Favourites">
            <ul>{favourites.map((b) => renderBook(b, 0, `fav:${b.id}`))}</ul>
          </Section>
        )}

        {(subjects.length > 0 || books.length > 0) && !filter && (
          <h3 className="text-ink-faint px-2 pt-2 pb-1 text-[10px] font-medium tracking-wide uppercase">
            Library
          </h3>
        )}

        {subjects.length === 0 && books.length === 0 ? (
          <div className="px-3 py-6">
            <p className="text-ink-muted text-xs">Your library is empty.</p>
            <button
              onClick={onImport}
              className="border-line hover:bg-hover text-ink-muted mt-3 w-full rounded border border-dashed px-2 py-3 text-xs"
            >
              Drop a PDF here, or click to import
            </button>
          </div>
        ) : (
          <ul>
            {childSubjects(null).map((s) => renderSubject(s, 0))}
            {loose.map((b) => renderBook(b, 0))}
          </ul>
        )}
      </div>
    </div>
  )
}
