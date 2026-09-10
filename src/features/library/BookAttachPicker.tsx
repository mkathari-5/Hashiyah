import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { displayTitle } from '@/lib/bookTitle'
import { hasArabic } from '@/lib/arabic'
import { listStoredPdfs } from '@/services/library/bookAttachment'
import { Icon } from '@/features/shell/Icon'

export type BookAttachChoice =
  | { kind: 'upload'; file: File }
  | { kind: 'existing'; bookId: string; documentId: string | null }

/**
 * Upload a PDF or attach one already stored in Hashiyyah.
 * Cancel produces no block.
 */
export function BookAttachPicker({
  title = 'Attach a PDF book',
  onChoose,
  onClose,
}: {
  title?: string
  onChoose: (choice: BookAttachChoice) => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const stored = useLiveQuery(() => listStoredPdfs(), [], [])
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = stored ?? []
    if (!q) return rows
    return rows.filter(({ book }) => {
      const hay = `${book.title} ${book.arabicTitle ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [stored, query])

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pickFile = (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    onChoose({ kind: 'upload', file })
  }

  return (
    <div className="page-study-pick" data-testid="book-attach-picker">
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="dialog"
        aria-label={title}
        className="slash-menu page-slash-menu book-attach-picker"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="book-attach-heading">{title}</p>
        <button
          type="button"
          className="slash-item"
          disabled={busy}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => inputRef.current?.click()}
        >
          <span className="slash-icon" aria-hidden>
            <Icon name="import" className="h-3.5 w-3.5" />
          </span>
          <span className="flex-1 truncate">{busy ? 'Importing…' : 'Upload a PDF from this computer'}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            pickFile(event.target.files?.[0])
            event.currentTarget.value = ''
          }}
        />

        <p className="book-attach-sub">Or attach a PDF already in Hashiyyah</p>
        <input
          ref={searchRef}
          className="book-attach-search"
          value={query}
          placeholder="Search titles"
          aria-label="Search stored PDFs"
          onChange={(event) => {
            setQuery(event.target.value)
            setIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setIndex((i) => (filtered.length ? (i + 1) % filtered.length : 0))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const row = filtered[index]
              if (row) onChoose({ kind: 'existing', bookId: row.book.id, documentId: row.document?.id ?? null })
            }
          }}
        />
        {filtered.length === 0 ? (
          <p className="text-ink-faint px-3 py-3 text-xs">
            {stored?.length ? 'No matching PDFs.' : 'No PDFs stored yet. Upload one above.'}
          </p>
        ) : (
          <div role="listbox" aria-label="Stored PDFs" className="book-attach-list">
            {filtered.map((row, i) => (
              <button
                key={row.book.id}
                type="button"
                role="option"
                aria-selected={i === index}
                className={`slash-item ${i === index ? 'is-active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  onChoose({ kind: 'existing', bookId: row.book.id, documentId: row.document?.id ?? null })
                }}
              >
                <span className="slash-icon" aria-hidden>
                  <Icon name="book" className="h-3.5 w-3.5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col items-start">
                  <span className="w-full truncate" dir={hasArabic(displayTitle(row.book)) ? 'rtl' : undefined}>
                    {displayTitle(row.book)}
                  </span>
                  <span className="text-ink-faint text-[10px] tabular-nums">
                    {row.document?.pageCount ?? row.book.pageCount} pages
                    {row.lastPage ? ` · last read p. ${row.lastPage}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="book-attach-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
