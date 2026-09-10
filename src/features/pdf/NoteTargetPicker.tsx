import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { libraryRepo } from '@/db/repos/libraryTree'
import { Icon } from '@/features/shell/Icon'
import { detectDirection } from '@/lib/dir'
import { listNoteTargets, type NoteTargetHit, type NoteTargetKind } from '@/services/notes/noteTargets'
import { PdfNoteLinkEngine } from '@/services/notes/PdfNoteLinkEngine'
import { useLibraryStore } from '@/state/useLibraryStore'
import { useNotesStore } from '@/state/useNotesStore'
import { useStudyStore } from '@/state/useStudyStore'
import type { PdfNoteAnchorKind } from '@/types'

const MARGIN = 8

function kindLabel(kind: NoteTargetKind): string {
  if (kind === 'heading') return 'Heading'
  if (kind === 'toggle') return 'Toggle'
  if (kind === 'semantic') return 'Section'
  return 'Block'
}

export function NoteTargetPicker() {
  const draft = useStudyStore((s) => s.linkDraft)
  const setLinkDraft = useStudyStore((s) => s.setLinkDraft)
  const bookId = useStudyStore((s) => s.bookId)
  const activeNoteId = useStudyStore((s) => s.activeNoteId)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<NoteTargetHit[]>([])
  const [index, setIndex] = useState(0)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [parentBlockId, setParentBlockId] = useState<string>('')
  const [parents, setParents] = useState<NoteTargetHit[]>([])
  const [relinkId, setRelinkId] = useState<string | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setQuery('')
    setCreating(false)
    setNewTitle('')
    setParentBlockId('')
    setIndex(0)
    setRelinkId(draft?.relinkId ?? null)
  }, [draft])

  useEffect(() => {
    if (!draft) return
    let cancelled = false
    void listNoteTargets({ bookId, currentNoteId: activeNoteId, query }).then((rows) => {
      if (cancelled) return
      setHits(rows)
      setIndex(0)
    })
    return () => {
      cancelled = true
    }
  }, [draft, bookId, activeNoteId, query])

  useEffect(() => {
    if (!creating || !activeNoteId) {
      setParents([])
      return
    }
    let cancelled = false
    void listNoteTargets({ bookId, currentNoteId: activeNoteId, query: '' }).then((rows) => {
      if (cancelled) return
      setParents(rows.filter((row) => row.noteId === activeNoteId && row.kind === 'toggle'))
    })
    return () => {
      cancelled = true
    }
  }, [creating, activeNoteId, bookId])

  useLayoutEffect(() => {
    if (!draft || !rootRef.current) {
      setPos(null)
      return
    }
    const box = rootRef.current.getBoundingClientRect()
    const left = Math.max(MARGIN, Math.min(draft.menuLeft, window.innerWidth - box.width - MARGIN))
    const below = draft.menuTop + 10
    const top =
      below + box.height + MARGIN <= window.innerHeight
        ? below
        : Math.max(MARGIN, draft.menuTop - box.height - 10)
    setPos({ left, top })
  }, [draft, hits.length, creating, query])

  useEffect(() => {
    if (!draft) return
    inputRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setLinkDraft(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [draft, setLinkDraft])

  if (!draft) return null

  const choose = async (hit: NoteTargetHit) => {
    if (busy) return
    setBusy(true)
    try {
      if (relinkId) {
        await PdfNoteLinkEngine.relink(relinkId, {
          noteDocumentId: hit.noteId,
          noteBlockId: hit.blockId,
          libraryItemId: hit.libraryItemId,
        })
        const link = await PdfNoteLinkEngine.get(relinkId)
        if (link) await PdfNoteLinkEngine.revealNote(link)
      } else {
        const link = await PdfNoteLinkEngine.create({
          bookId: draft.bookId,
          documentId: draft.documentId,
          capture: draft.capture,
          textSource: draft.textSource,
          anchorKind: inferAnchorKind(draft),
          noteDocumentId: hit.noteId,
          noteBlockId: hit.blockId,
          libraryItemId: hit.libraryItemId ?? useLibraryStore.getState().activeNodeId,
        })
        await PdfNoteLinkEngine.revealNote(link)
      }
      setLinkDraft(null)
      useStudyStore.getState().setSelection(null)
      window.getSelection()?.removeAllRanges()
    } finally {
      setBusy(false)
    }
  }

  const createSection = async () => {
    const title = newTitle.trim()
    const noteId = activeNoteId
    if (!title || !noteId || busy) return
    setBusy(true)
    try {
      const blockId = await PdfNoteLinkEngine.createNamedSection({
        noteId,
        title,
        parentBlockId: parentBlockId || null,
      })
      const owner = await libraryRepo.owner(noteId)
      const link = relinkId
        ? await PdfNoteLinkEngine.relink(relinkId, {
            noteDocumentId: noteId,
            noteBlockId: blockId,
            libraryItemId: owner?.id ?? useLibraryStore.getState().activeNodeId,
          })
        : await PdfNoteLinkEngine.create({
            bookId: draft.bookId,
            documentId: draft.documentId,
            capture: draft.capture,
            textSource: draft.textSource,
            anchorKind: inferAnchorKind(draft),
            noteDocumentId: noteId,
            noteBlockId: blockId,
            libraryItemId: owner?.id ?? useLibraryStore.getState().activeNodeId,
          })
      if (link) {
        await PdfNoteLinkEngine.revealNote(link)
        useNotesStore.getState().requestScrollTo(noteId, blockId, { placeCaret: true })
      }
      setLinkDraft(null)
      useStudyStore.getState().setSelection(null)
      window.getSelection()?.removeAllRanges()
    } finally {
      setBusy(false)
    }
  }

  const visible = hits

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Link to note"
      className="note-target-picker"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {!creating ? (
        <>
          <div className="note-target-picker-head">
            <Icon name="link" />
            <span>Link to note</span>
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sections…"
            aria-label="Search note sections"
            className="note-target-picker-search"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setIndex((i) => Math.min(visible.length - 1, i + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setIndex((i) => Math.max(0, i - 1))
              } else if (event.key === 'Enter' && visible[index]) {
                event.preventDefault()
                void choose(visible[index]!)
              }
            }}
          />
          <ul className="note-target-picker-list" role="listbox">
            {visible.map((hit, i) => (
              <li key={`${hit.noteId}:${hit.blockId}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  className={`note-target-picker-item${i === index ? ' is-active' : ''}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => void choose(hit)}
                >
                  <span className="note-target-picker-kind">{kindLabel(hit.kind)}</span>
                  <span className="note-target-picker-title" dir={detectDirection(hit.title)} title={hit.title}>
                    {hit.title}
                  </span>
                  <span className="note-target-picker-crumb" dir="auto">
                    {hit.breadcrumb.join(' › ')}
                  </span>
                </button>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="note-target-picker-empty">No matching sections.</li>
            )}
          </ul>
          <button
            type="button"
            className="note-target-picker-create"
            onClick={() => {
              setCreating(true)
              setNewTitle(query.trim())
            }}
          >
            Create new note section
          </button>
        </>
      ) : (
        <>
          <div className="note-target-picker-head">
            <Icon name="plus" />
            <span>New note section</span>
          </div>
          <input
            ref={inputRef}
            value={newTitle ?? ''}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Section title"
            aria-label="New section title"
            className="note-target-picker-search"
            dir="auto"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void createSection()
              }
            }}
          />
          {parents.length > 0 && (
            <label className="note-target-picker-parent">
              <span>Inside</span>
              <select value={parentBlockId} onChange={(e) => setParentBlockId(e.target.value)}>
                <option value="">Current note (top level)</option>
                {parents.map((parent) => (
                  <option key={parent.blockId} value={parent.blockId}>
                    {parent.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="note-target-picker-actions">
            <button type="button" className="ui-btn" onClick={() => setCreating(false)}>
              Back
            </button>
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              disabled={!newTitle.trim() || !activeNoteId || busy}
              onClick={() => void createSection()}
            >
              Create and link
            </button>
          </div>
        </>
      )}
    </div>,
    document.body,
  )
}

function inferAnchorKind(draft: NonNullable<ReturnType<typeof useStudyStore.getState>['linkDraft']>): PdfNoteAnchorKind {
  if (draft.anchorKind) return draft.anchorKind
  const text = draft.capture.text.trim()
  if (text) return 'text-selection'
  const rect = draft.capture.rects[0]
  if (!rect || (rect.w < 0.008 && rect.h < 0.008)) return 'point'
  return 'region'
}
