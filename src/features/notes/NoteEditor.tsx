import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { emptyDoc, noteDocsRepo } from '@/db/repos/notes'
import { BlockHandle } from '@/features/notes/BlockHandle'
import { NoteFind, NoteFindBar } from '@/features/notes/NoteFindBar'
import { BlockId } from '@/features/notes/extensions/BlockId'
import { BlockDirection } from '@/features/notes/extensions/BlockDirection'
import { ImageBlock } from '@/features/notes/extensions/ImageBlock'
import { QuranBlock, HadithBlock } from '@/features/notes/extensions/ScriptureBlocks'
import { SemanticBlock } from '@/features/notes/extensions/SemanticBlock'
import { SlashCommand } from '@/features/notes/extensions/SlashCommand'
import { SourceGroup } from '@/features/notes/extensions/SourceGroup'
import { SourceQuote } from '@/features/notes/extensions/SourceQuote'
import { ToggleBlock, ToggleContent, ToggleSummary } from '@/features/notes/extensions/Toggle'
import { WikiLink, handleWikiLinkClick } from '@/features/notes/extensions/WikiLink'
import { FormatBar } from '@/features/notes/FormatBar'
import {
  applyToggleStates,
  collectOutline,
  collectToggleStates,
  countWords,
  saveNote,
  type OutlineEntry,
} from '@/services/notes/NotesService'
import { useAppStore } from '@/state/useAppStore'
import { useNotesStore } from '@/state/useNotesStore'
import { useStudyStore } from '@/state/useStudyStore'

const AUTOSAVE_MS = 400
/** Lesson mode saves harder — a dropped laptop lid mid-lesson costs more (§22). */
const LESSON_AUTOSAVE_MS = 150

const extensions = [
  StarterKit.configure({
    link: { openOnClick: false, autolink: true },
    heading: { levels: [1, 2, 3] },
  }),
  Highlight.configure({ multicolor: true }),
  TextStyle,
  Color,
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  Placeholder.configure({
    includeChildren: true,
    placeholder: ({ node }) => {
      if (node.type.name === 'heading') return 'Heading'
      if (node.type.name === 'toggleSummary') return 'Toggle title'
      if (node.type.name === 'quranBlock') return 'اكتب الآية هنا'
      if (node.type.name === 'hadithBlock') return 'اكتب متن الحديث هنا'
      return "Type '/' for blocks, or just start writing…"
    },
  }),
  SourceGroup,
  SourceQuote,
  SemanticBlock,
  QuranBlock,
  HadithBlock,
  ImageBlock,
  ToggleBlock,
  ToggleSummary,
  ToggleContent,
  WikiLink,
  BlockDirection,
  BlockId,
  SlashCommand,
  NoteFind,
]

export interface NoteEditorHandle {
  outline: () => OutlineEntry[]
  jumpToBlock: (blockId: string) => void
  collapseAll: (collapsed: boolean) => void
  openFind: () => void
  focus: () => void
}

interface Props {
  noteId: string
  ref?: React.Ref<NoteEditorHandle>
  onStats?: (stats: { words: number }) => void
}

export function NoteEditor({ noteId, ref, onStats }: Props) {
  const markSaving = useAppStore((s) => s.markSaving)
  const markSaved = useAppStore((s) => s.markSaved)
  const isLesson = useAppStore((s) => s.layout === 'lesson')
  const pendingInsert = useNotesStore((s) => s.pendingInsert)
  const clearInsert = useNotesStore((s) => s.clearInsert)
  const pendingScroll = useNotesStore((s) => s.pendingScroll)
  const clearScroll = useNotesStore((s) => s.clearScroll)
  const revisionMode = useNotesStore((s) => s.revisionMode)
  const setRevisionMode = useNotesStore((s) => s.setRevisionMode)
  const revealRequest = useStudyStore((s) => s.revealRequest)

  const [loadedNoteId, setLoadedNoteId] = useState<string | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const noteIdRef = useRef(noteId)
  const dirtyRef = useRef(false)
  const timerRef = useRef<number | undefined>(undefined)
  const scrollRef = useRef<HTMLDivElement>(null)

  /**
   * How the reader had actually left their toggles, held for as long as
   * revision mode is flattening them; null whenever it is not (§E30).
   *
   * It lives in this component rather than in a store because it describes
   * *this* document, and this component's lifetime is exactly the lifetime of
   * that document being open.
   */
  const revisionSnapshotRef = useRef<Record<string, boolean> | null>(null)

  const editor = useEditor({
    extensions,
    content: emptyDoc(),
    autofocus: false,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'ProseMirror focus:outline-none', spellcheck: 'false' },
      handleClick: (_view, _pos, event) => handleWikiLinkClick(event as MouseEvent),
      /**
       * §33 — smart paste. Plain-text paste (Ctrl+Shift+V) is handled by the
       * browser; what matters here is that a normal paste of Arabic keeps its
       * characters and its paragraph breaks without importing a wall of CSS.
       * ProseMirror's own HTML parser already drops unknown styling, so the job
       * is simply not to interfere with it.
       */
      transformPastedText: (text) => text.replace(/\r\n?/g, '\n'),
    },
  })

  /**
   * What a save should write.
   *
   * While revising, the document on screen is deliberately flattened — that is
   * the mode. Persisting it would turn a way of *reading* a chapter into an
   * edit of it, so every save writes the reader's own toggle states back over
   * the collapsed ones. This is why leaving a chapter mid-revision, by any
   * route including closing the tab, cannot flatten it.
   */
  const documentToSave = useCallback(() => {
    if (!editor) return null
    const doc = editor.getJSON()
    const snapshot = revisionSnapshotRef.current
    return snapshot ? applyToggleStates(doc, snapshot) : doc
  }, [editor])

  // ── Autosave ──────────────────────────────────────────────────────────────
  const flush = useCallback(async () => {
    if (!editor || !dirtyRef.current) return
    dirtyRef.current = false
    window.clearTimeout(timerRef.current)
    markSaving()
    try {
      await saveNote(noteIdRef.current, documentToSave())
      setSaveError(null)
      markSaved()
    } catch (error) {
      dirtyRef.current = true
      setSaveError(error instanceof Error ? error.message : 'This note could not be saved.')
      markSaved()
    }
  }, [editor, documentToSave, markSaving, markSaved])

  useEffect(() => {
    if (!editor) return
    const delay = isLesson ? LESSON_AUTOSAVE_MS : AUTOSAVE_MS
    const onUpdate = () => {
      dirtyRef.current = true
      onStats?.({ words: countWords(editor.getJSON()) })
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => void flush(), delay)
    }
    const onBlur = () => void flush()
    editor.on('update', onUpdate)
    editor.on('blur', onBlur)
    return () => {
      editor.off('update', onUpdate)
      editor.off('blur', onBlur)
    }
  }, [editor, flush, isLesson, onStats])

  // Never lose a keystroke to a closing tab or a backgrounded app (§36).
  useEffect(() => {
    const onHide = () => void flush()
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
      void flush()
    }
  }, [flush])

  // ── Load the active note (flushing the previous one first) ────────────────
  useEffect(() => {
    if (!editor) return
    let cancelled = false
    void (async () => {
      await flush()
      const row = await noteDocsRepo.get(noteId)
      if (cancelled || editor.isDestroyed) return
      noteIdRef.current = noteId
      editor.commands.setContent(row?.doc ?? emptyDoc(), { emitUpdate: false })
      dirtyRef.current = false
      setLoadedNoteId(noteId)
      onStats?.({ words: countWords(editor.getJSON()) })
    })()
    return () => {
      cancelled = true
    }
    // `flush` intentionally omitted: it closes over the *previous* note id,
    // which is exactly what we want when switching away from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, editor])

  /**
   * The reader's last caret position, remembered so content arriving from the
   * PDF lands where they were working rather than at the bottom (§D3).
   * Stored as a raw offset and re-validated at insert time.
   */
  const lastPosRef = useRef<number | null>(null)
  useEffect(() => {
    if (!editor) return
    const remember = () => {
      const { from, empty } = editor.state.selection
      if (empty) lastPosRef.current = from
    }
    editor.on('selectionUpdate', remember)
    return () => {
      editor.off('selectionUpdate', remember)
    }
  }, [editor])

  // Forget the position when switching notes — it belongs to the old document.
  useEffect(() => {
    lastPosRef.current = null
  }, [noteId])

  // ── Content arriving from the PDF lands here ──────────────────────────────
  useEffect(() => {
    if (!editor || !pendingInsert || loadedNoteId !== noteId) return
    const at = lastPosRef.current ?? undefined
    const { shape, annotationId, blockKind, assetId, withExplanation } = pendingInsert

    if (shape === 'image' && assetId) {
      editor.chain().insertCapture({ assetId, annotationId, withExplanation, at }).run()
    } else if (annotationId) {
      editor
        .chain()
        .insertSourceQuote({
          annotationId,
          blockKind,
          shape: shape === 'image' ? 'quote' : shape,
          at,
        })
        .run()
    }

    // Tiptap's `.focus()` command defers the actual DOM focus to
    // requestAnimationFrame. For the interactions this product is built around,
    // the caret must be blinking *now* — not next frame, and not never if the
    // tab happens to be throttled. So we focus the view directly.
    editor.view.focus()
    lastPosRef.current = editor.state.selection.from
    clearInsert()
  }, [editor, pendingInsert, clearInsert, loadedNoteId, noteId])

  // ── Reveal the quotation for a clicked highlight (§9, reverse direction) ──
  useEffect(() => {
    if (!editor || !revealRequest || loadedNoteId !== revealRequest.noteId) return
    let found: number | null = null
    editor.state.doc.descendants((node, pos) => {
      if (found !== null) return false
      if (node.type.name === 'sourceQuote' && node.attrs.annotationId === revealRequest.annotationId) {
        found = pos
        return false
      }
      return true
    })
    if (found !== null) {
      editor.chain().setNodeSelection(found).scrollIntoView().run()
    }
  }, [editor, revealRequest, loadedNoteId])

  // ── Scroll to a block, from the sidebar outline or a search result ────────
  useEffect(() => {
    if (!editor || !pendingScroll || loadedNoteId !== pendingScroll.noteId) return

    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-block-id="${pendingScroll.blockId}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // A brief pulse so the eye lands on the right block; the note itself is
      // never modified by navigating to it.
      el.classList.add('block-pulse')
      window.setTimeout(() => el.classList.remove('block-pulse'), 1200)
    }
    clearScroll()
  }, [editor, pendingScroll, loadedNoteId, clearScroll])

  // ── Revision mode (§E30) ──────────────────────────────────────────────────
  // Holding the snapshot is itself the record that revision is applied to this
  // document: there is no second flag to fall out of step with it.
  useEffect(() => {
    if (!editor || loadedNoteId !== noteId) return

    if (revisionMode && !revisionSnapshotRef.current) {
      // Record what the reader actually had open before flattening anything.
      revisionSnapshotRef.current = collectToggleStates(editor.getJSON())
      editor.commands.setAllTogglesOpen(false)
      return
    }

    if (!revisionMode && revisionSnapshotRef.current) {
      const snapshot = revisionSnapshotRef.current
      revisionSnapshotRef.current = null
      const tr = editor.state.tr
      let changed = false
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'toggleBlock') return
        const was = snapshot[node.attrs.blockId as string]
        if (was !== undefined && node.attrs.open !== was) {
          tr.setNodeAttribute(pos, 'open', was)
          changed = true
        }
      })
      if (changed) editor.view.dispatch(tr)
    }
  }, [editor, revisionMode, loadedNoteId, noteId])

  /**
   * A note opens out of revision mode, always.
   *
   * Revision belongs to a reading of one chapter, and the panel remounts this
   * editor per note, so a chapter switch mid-revision lands here: the previous
   * chapter's sections have already gone back (every save writes the snapshot,
   * see `documentToSave`), and the chapter now opening opens normally rather
   * than inheriting a mode — or a snapshot — that described the last one.
   */
  useEffect(() => {
    setRevisionMode(false)
    // Deliberately not reacting to `revisionMode`: this is about arriving at a
    // note, not about the reader turning the mode on while reading it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId])

  // ── Find within note ──────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f' || event.shiftKey) return
      if (!editor?.isFocused && !scrollRef.current?.contains(document.activeElement)) return
      event.preventDefault()
      setFindOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor])

  useImperativeHandle(
    ref,
    () => ({
      outline: () => (editor ? collectOutline(editor.getJSON()) : []),
      jumpToBlock: (blockId) => {
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      },
      collapseAll: (collapsed) => editor?.commands.setAllTogglesOpen(!collapsed),
      openFind: () => setFindOpen(true),
      focus: () => editor?.view.focus(),
    }),
    [editor],
  )

  if (!editor) return null

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {findOpen && <NoteFindBar editor={editor} onClose={() => setFindOpen(false)} />}

      {saveError && (
        <div className="bg-hl-rose/15 text-hl-rose border-hl-rose/30 border-b px-4 py-1.5 text-xs">
          {saveError}
        </div>
      )}

      <div
        ref={scrollRef}
        className={`note-surface relative min-h-0 flex-1 overflow-y-auto px-8 py-5 ${
          revisionMode ? 'is-revising' : ''
        }`}
      >
        <EditorContent editor={editor} />
        {/* The block grip is editing chrome, and revision is for reading. */}
        {!revisionMode && <BlockHandle editor={editor} scrollRef={scrollRef} />}
      </div>

      <FormatBar editor={editor} />
    </div>
  )
}
