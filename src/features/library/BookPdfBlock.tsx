import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { LibraryBlock } from '@/types'
import { displayTitle } from '@/lib/bookTitle'
import { hasArabic } from '@/lib/arabic'
import { pdfStatusForBlock } from '@/services/library/bookAttachment'
import { ContextMenu } from '@/features/shell/ContextMenu'
import { Icon } from '@/features/shell/Icon'

export function BookPdfBlock({
  block,
  onOpen,
  onRename,
  onReplace,
  onDetach,
  onDelete,
  onAttach,
}: {
  block: LibraryBlock
  onOpen: () => void
  onRename: (title: string) => void
  onReplace: (file: File) => void
  onDetach: () => void
  onDelete: () => void
  onAttach: () => void
}) {
  const status = useLiveQuery(() => pdfStatusForBlock(block), [block.bookId, block.documentId, block.id])
  const fileRef = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(block.content)

  const book = status?.book
  const title = block.content.trim() || (book ? displayTitle(book) : 'Untitled book')
  const pages = status?.document?.pageCount ?? book?.pageCount ?? null
  const lastPage = status?.lastPage
  const missing = !!status?.missingFile
  const empty = !block.bookId && !block.documentId
  const rtl = hasArabic(title)

  return (
    <div
      className={`book-pdf-card${empty || missing ? ' is-empty' : ''}`}
      data-testid="book-pdf-block"
      data-book-id={block.bookId ?? ''}
      data-document-id={block.documentId ?? ''}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      <button
        type="button"
        className="book-pdf-main"
        aria-label={`Open book ${title}`}
        onClick={(event) => {
          event.stopPropagation()
          onOpen()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen()
          }
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault()
            onDetach()
          }
        }}
      >
        <span className="book-pdf-icon" aria-hidden>
          <Icon name="file" />
        </span>
        <span className="book-pdf-copy">
          {renaming ? (
            <input
              className="book-pdf-rename"
              value={draft}
              autoFocus
              aria-label="Displayed title"
              dir={rtl ? 'rtl' : undefined}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                onRename(draft.trim() || title)
                setRenaming(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onRename(draft.trim() || title)
                  setRenaming(false)
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setDraft(block.content)
                  setRenaming(false)
                }
              }}
            />
          ) : (
            <span className="book-pdf-title" dir={rtl ? 'rtl' : undefined} title={title}>
              {title}
            </span>
          )}
          <span className="book-pdf-meta">
            {empty
              ? 'No PDF attached'
              : missing
                ? 'PDF unavailable'
                : [
                    pages != null ? `${pages} pages` : null,
                    lastPage ? `Last read p. ${lastPage}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="book-pdf-open"
        onClick={(event) => {
          event.stopPropagation()
          if (empty || missing) onAttach()
          else onOpen()
        }}
      >
        {empty ? 'Attach PDF' : missing ? 'Relink' : 'Open book'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onReplace(file)
          event.currentTarget.value = ''
        }}
      />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={`Actions for ${title}`}
          onClose={() => setMenu(null)}
          items={[
            { id: 'open', label: 'Open book', onSelect: onOpen },
            ...(empty
              ? [{ id: 'attach', label: 'Attach PDF', onSelect: onAttach }]
              : missing
                ? [{ id: 'relink', label: 'Relink', onSelect: onAttach }]
                : []),
            {
              id: 'rename',
              label: 'Rename displayed title',
              onSelect: () => {
                setDraft(title)
                setRenaming(true)
              },
            },
            { id: 'replace', label: 'Replace attached PDF', onSelect: () => fileRef.current?.click() },
            { id: 'detach', label: 'Detach PDF', onSelect: onDetach },
            {
              id: 'delete',
              label: 'Delete block',
              danger: true,
              onSelect: onDelete,
            },
          ]}
        />
      )}
    </div>
  )
}
