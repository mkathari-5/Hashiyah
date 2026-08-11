/**
 * Domain types — the single source of truth for the shape of everything stored.
 *
 * Rule: nothing in here imports from anywhere else. Services and repositories
 * depend on these; these depend on nobody.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Library
// ─────────────────────────────────────────────────────────────────────────────

export interface Subject {
  id: string
  parentId: string | null
  name: string
  arabicName?: string
  icon?: string
  order: number
  collapsed?: boolean
  createdAt: number
  updatedAt: number
}

export type BookLanguage = 'ar' | 'en' | 'mixed' | 'unknown'

export interface Book {
  id: string
  subjectId: string | null
  title: string
  arabicTitle?: string
  author?: string
  arabicAuthor?: string
  publisher?: string
  edition?: string
  language: BookLanguage
  pageCount: number
  tags: string[]
  favorite: boolean
  order: number
  createdAt: number
  updatedAt: number
  lastOpenedAt: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Library tree (Phase E)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a node in the library *is*. Deliberately a small vocabulary — the shape
 * of a study library comes from nesting, not from having a type for everything.
 *
 *  science  a discipline: ʿAqīdah, Fiqh, Ḥadīth…
 *  folder   a grouping inside one, when a science gets large
 *  book     presents an existing Book record (never duplicates it)
 *  course   a dawrah or lecture series
 *  chapter  the study unit: a bāb, with its own notes
 *  lesson   a session within a course
 *  notes    a notes-only item — "Questions to ask Ustādh", a timetable
 */
export type LibraryNodeType = 'science' | 'folder' | 'book' | 'course' | 'chapter' | 'lesson' | 'notes'

export interface LibraryNode {
  id: string
  /** null = a top-level entry under the implicit root. */
  parentId: string | null
  type: LibraryNodeType
  order: number
  title: string
  arabicTitle?: string

  /**
   * The existing Book this node presents. The PDF, its pages, annotations and
   * anchors all continue to live on the Book record — this is a reference, so
   * nothing that already points at a book is disturbed.
   */
  bookId?: string | null
  /**
   * The node's own stable notes document. Created once, on first open, and
   * reused forever after — clicking a chapter tomorrow reopens the same notes.
   */
  noteId?: string | null

  favorite: boolean
  /** Expansion state, so the tree looks the way you left it. */
  collapsed: boolean

  pageStart?: number | null
  pageEnd?: number | null
  teacher?: string
  lessonNumber?: number

  lastOpenedAt: number | null
  createdAt: number
  updatedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Documents & pages
// ─────────────────────────────────────────────────────────────────────────────

/** Where a page's text came from. Lets OCR land later without touching anchors. */
export type TextSource = 'embedded' | 'ocr' | 'none'

export interface DocumentMeta {
  id: string
  bookId: string
  filename: string
  byteLength: number
  /** SHA-256 of the file bytes — identity of the exact edition. */
  fingerprint: string
  pageCount: number
  createdAt: number
}

export interface DocumentBlob {
  documentId: string
  blob: Blob
}

export interface PageRecord {
  id: string // `${documentId}:${pageNumber}`
  documentId: string
  pageNumber: number
  /** Canonical page text, exactly as extracted. Never normalised in place. */
  text: string
  /** Search representation. Lossy by design; the raw `text` is authoritative. */
  normalizedText: string
  /** Character offset of each text item into `text`, parallel to pdf.js textDivs. */
  itemOffsets: number[]
  width: number
  height: number
  rotation: number
  hasTextLayer: boolean
  textSource: TextSource
  indexedAt: number
}

export interface OutlineNode {
  id: string
  bookId: string
  parentId: string | null
  title: string
  pageNumber: number | null
  order: number
  source: 'pdf' | 'manual'
}

// ─────────────────────────────────────────────────────────────────────────────
// Annotations & anchors
// ─────────────────────────────────────────────────────────────────────────────

export const ANNOTATION_KINDS = [
  'highlight',
  'explain',
  'benefit',
  'definition',
  'evidence',
  'teacher',
  'question',
  'reference',
  'important',
  /** A snipped page region rather than a text selection (§D12). */
  'capture',
] as const

export type AnnotationKind = (typeof ANNOTATION_KINDS)[number]

export type HighlightColor = 'amber' | 'green' | 'blue' | 'rose' | 'violet' | 'neutral'

export interface Annotation {
  id: string
  bookId: string
  documentId: string
  pageNumber: number
  kind: AnnotationKind
  color: HighlightColor
  /** Raw selected text, byte-for-byte as it appeared. Sacred. */
  selectedText: string
  normalizedText: string
  textSource: TextSource
  /** Phase 2. Present in the schema so annotations never need a migration. */
  layerId: string | null
  lessonId: string | null
  createdAt: number
  updatedAt: number
}

/** A rectangle in normalised page space: 0..1 of page width/height, top-left origin. */
export interface NormalizedRect {
  x: number
  y: number
  w: number
  h: number
}

export const ANCHOR_VERSION = 1

export interface AnnotationAnchor {
  id: string
  annotationId: string
  documentId: string
  pageNumber: number
  /** Offsets into PageRecord.text. */
  startOffset: number
  endOffset: number
  /** Indices into the page's text-item array. */
  itemStart: number
  itemEnd: number
  /** Which occurrence of `normalizedText` on this page (0-based). */
  occurrenceIndex: number
  textBefore: string
  textAfter: string
  rects: NormalizedRect[]
  pageWidth: number
  pageHeight: number
  pageRotation: number
  anchorVersion: number
}

export type AnchorStrategy =
  | 'exact'
  | 'context'
  | 'occurrence'
  | 'unique'
  | 'neighbour'
  | 'geometric'
  | 'unresolved'

export interface AnchorResolution {
  strategy: AnchorStrategy
  confidence: number
  pageNumber: number
  startOffset: number
  endOffset: number
  /** Present when text-based resolution succeeded; else falls back to stored rects. */
  rects: NormalizedRect[]
  resolvedText: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Notes
// ─────────────────────────────────────────────────────────────────────────────

export interface Note {
  id: string
  bookId: string | null
  title: string
  outlineNodeId: string | null
  lessonId: string | null
  layerId: string | null
  order: number
  createdAt: number
  updatedAt: number
}

/** ProseMirror document JSON. Kept opaque here on purpose. */
export interface NoteDoc {
  noteId: string
  doc: unknown
  updatedAt: number
}

/**
 * Derived join table. Re-computed from the ProseMirror doc on every save, so it
 * can never drift from what the note actually contains.
 */
export interface QuoteRef {
  id: string // `${noteId}:${blockId}`
  noteId: string
  annotationId: string
  blockId: string
  order: number
}

/**
 * Images live in their own table, referenced by id from the note document.
 * Inlining them as data URLs would bloat every note load and every autosave
 * with megabytes of base64 the editor never needs in memory.
 */
export interface Asset {
  id: string
  blob: Blob
  mime: string
  width: number
  height: number
  createdAt: number
}

export type LinkTargetType = 'note' | 'book' | 'concept'

/**
 * Wiki-style `[[ ]]` references, derived from note documents on save by the
 * same mechanism as QuoteRef. Unresolved targets are kept deliberately: writing
 * `[[Ḥanīfiyyah]]` before that note exists is a normal way to work, and the
 * link should light up on its own once the target appears.
 */
export interface NoteLink {
  id: string // `${sourceNoteId}:${blockId}:${label}`
  sourceNoteId: string
  blockId: string
  targetType: LinkTargetType
  /** Resolved id, or null while the target does not exist yet. */
  targetId: string | null
  label: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Session / app state
// ─────────────────────────────────────────────────────────────────────────────

export interface ReadingState {
  bookId: string
  pageNumber: number
  /** 0..1 within the page — resolution independent. */
  scrollRatio: number
  zoom: number
  activeNoteId: string | null
  updatedAt: number
}

export interface AppStateRow {
  key: string
  value: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase-2 tables. Declared now so schema v1 is the only schema for a while.
// ─────────────────────────────────────────────────────────────────────────────

export interface CommentaryLayer {
  id: string
  bookId: string
  name: string
  teacher?: string
  color: HighlightColor
  visible: boolean
  order: number
  createdAt: number
}

export interface Bookmark {
  id: string
  bookId: string
  documentId: string
  pageNumber: number
  label: string
  comment?: string
  color: HighlightColor
  createdAt: number
}

export interface Lesson {
  id: string
  bookId: string
  title: string
  teacher?: string
  number?: number
  date: number
  pageStart?: number
  pageEnd?: number
  /** Accumulated study seconds, so a lesson resumed tomorrow keeps its total. */
  elapsedSeconds: number
  createdAt: number
}
