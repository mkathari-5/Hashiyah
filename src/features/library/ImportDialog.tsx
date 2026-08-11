import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { subjectsRepo } from '@/db/repos/library'
import { importPdf, indexDocument, type ImportProgress } from '@/services/pdf/importer'
import { useStudyStore } from '@/state/useStudyStore'
import { Icon } from '@/features/shell/Icon'

interface Props {
  file: File | null
  open: boolean
  onClose: () => void
  onPickFile: (file: File) => void
}

/**
 * Import (§50): infer what can safely be inferred, let the user correct it, and
 * never block opening the book on metadata. Text indexing starts in the
 * background the moment the book exists.
 */
export function ImportDialog({ file, open, onClose, onPickFile }: Props) {
  const subjects = useLiveQuery(() => subjectsRepo.all(), [], [])
  const openBook = useStudyStore((s) => s.openBook)
  const inputRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState('')
  const [arabicTitle, setArabicTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [subjectId, setSubjectId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle(file ? file.name.replace(/\.pdf$/i, '').replace(/_+/g, ' ').trim() : '')
    setArabicTitle('')
    setAuthor('')
    setError(null)
    setProgress(null)
    setBusy(false)
  }, [open, file])

  if (!open) return null

  const runImport = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const result = await importPdf(file, {
        subjectId: subjectId || null,
        title: title || undefined,
        arabicTitle: arabicTitle || undefined,
        author: author || undefined,
        onProgress: setProgress,
      })
      // Reading can start immediately; indexing continues behind it.
      indexDocument(result.document.id, result.book.id, setProgress)
      await openBook(result.book.id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This file could not be imported.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-6" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import a book"
        className="border-line bg-elevated w-full max-w-md rounded-lg border p-5 shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-ink mb-4 text-sm font-semibold">Import a book</h2>

        {!file ? (
          <button
            onClick={() => inputRef.current?.click()}
            className="border-line hover:bg-hover text-ink-muted flex w-full flex-col items-center gap-2 rounded border border-dashed px-4 py-10 text-xs"
          >
            <Icon name="import" className="h-5 w-5" />
            Choose a PDF, or drop one anywhere in the app
          </button>
        ) : (
          <>
            <div className="border-line bg-panel mb-4 flex items-center gap-2 rounded border px-3 py-2">
              <Icon name="file" className="text-ink-faint" />
              <span className="text-ink truncate text-xs">{file.name}</span>
              <span className="text-ink-faint ms-auto text-[11px] tabular-nums">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </span>
            </div>

            <div className="space-y-3">
              <Field label="Title" value={title} onChange={setTitle} autoFocus />
              <Field label="Arabic title" value={arabicTitle} onChange={setArabicTitle} rtl />
              <Field label="Author" value={author} onChange={setAuthor} />
              <label className="block">
                <span className="text-ink-muted mb-1 block text-[11px]">Subject</span>
                <select
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  className="border-line bg-panel text-ink w-full rounded border px-2 py-1.5 text-xs"
                >
                  <option value="">Unfiled</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0]
            if (picked) onPickFile(picked)
          }}
        />

        {error && <p className="text-hl-rose mt-3 text-xs">{error}</p>}
        {busy && progress && (
          <p className="text-ink-faint mt-3 text-xs">
            {progress.stage === 'indexing'
              ? `Indexing page ${progress.page} of ${progress.total}…`
              : `${progress.stage}…`}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="hover:bg-hover text-ink-muted rounded px-3 py-1.5 text-xs"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            onClick={runImport}
            disabled={!file || busy}
            className="bg-accent rounded px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {busy ? 'Importing…' : 'Import and open'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  rtl,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  rtl?: boolean
  autoFocus?: boolean
}) {
  return (
    <label className="block">
      <span className="text-ink-muted mb-1 block text-[11px]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir={rtl ? 'rtl' : undefined}
        autoFocus={autoFocus}
        className={`border-line bg-panel text-ink w-full rounded border px-2 py-1.5 text-xs ${
          rtl ? 'font-arabic' : ''
        }`}
      />
    </label>
  )
}
