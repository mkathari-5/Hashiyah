import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { booksRepo } from '@/db/repos/library'
import { pagesRepo } from '@/db/repos/documents'
import { Icon } from '@/features/shell/Icon'
import { useAppStore } from '@/state/useAppStore'
import { useStudyStore } from '@/state/useStudyStore'

export function StatusBar() {
  const saving = useAppStore((s) => s.saving)
  const savedAt = useAppStore((s) => s.savedAt)
  const layout = useAppStore((s) => s.layout)
  const toggleLessonMode = useAppStore((s) => s.toggleLessonMode)

  const bookId = useStudyStore((s) => s.bookId)
  const documentId = useStudyStore((s) => s.documentId)
  const currentPage = useStudyStore((s) => s.currentPage)
  const pageCount = useStudyStore((s) => s.pageCount)

  const book = useLiveQuery(() => (bookId ? booksRepo.get(bookId) : undefined), [bookId])
  const indexed = useLiveQuery(
    () => (documentId ? pagesRepo.countFor(documentId) : Promise.resolve(0)),
    [documentId],
    0,
  )
  const pageOnScreen = useLiveQuery(
    () => (documentId ? pagesRepo.get(documentId, currentPage) : undefined),
    [documentId, currentPage],
  )
  const notesOnPage = useLiveQuery(async () => {
    if (!documentId) return 0
    return db.annotations.where('[documentId+pageNumber]').equals([documentId, currentPage]).count()
  }, [documentId, currentPage], 0)

  const [savedLabel, setSavedLabel] = useState(false)
  useEffect(() => {
    if (!savedAt) return
    setSavedLabel(true)
    const timer = setTimeout(() => setSavedLabel(false), 1800)
    return () => clearTimeout(timer)
  }, [savedAt])

  const indexing = documentId && pageCount > 0 && indexed < pageCount
  const noTextLayer = pageOnScreen && !pageOnScreen.hasTextLayer

  return (
    <footer className="border-line bg-panel text-ink-faint flex h-7 shrink-0 items-center gap-3 border-t px-3 text-[11px]">
      {book ? (
        <>
          <span className="truncate">{book.title}</span>
          <span className="tabular-nums">
            p. {currentPage} / {pageCount}
          </span>
        </>
      ) : (
        <span>No book open</span>
      )}

      {noTextLayer && (
        <span className="text-hl-rose" title="This page is an image. Text selection needs OCR, which is not in this release.">
          Image-only page — no selectable text
        </span>
      )}

      {indexing && (
        <span className="tabular-nums">
          Indexing {indexed} / {pageCount}
        </span>
      )}

      <div className="ms-auto flex items-center gap-3">
        {notesOnPage > 0 && (
          <span className="tabular-nums">
            {notesOnPage} {notesOnPage === 1 ? 'annotation' : 'annotations'} on this page
          </span>
        )}

        <span className="min-w-14 text-end">
          {saving ? 'Saving…' : savedLabel ? 'Saved ✓' : ''}
        </span>

        {layout === 'lesson' && <LessonTimer onExit={toggleLessonMode} />}
      </div>
    </footer>
  )
}

function LessonTimer({ onExit }: { onExit: () => void }) {
  const startedAt = useStudyStore((s) => s.lessonStartedAt)
  const start = useStudyStore((s) => s.startLessonTimer)
  const [, tick] = useState(0)

  useEffect(() => {
    if (!startedAt) start()
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [startedAt, start])

  const elapsed = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')

  return (
    <button
      onClick={onExit}
      title="Leave Lesson Mode"
      className="text-accent hover:bg-hover flex items-center gap-1.5 rounded px-1.5 py-0.5 tabular-nums"
    >
      <Icon name="clock" className="h-3 w-3" />
      {mm}:{ss}
    </button>
  )
}
