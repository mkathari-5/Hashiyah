import Dexie, { type Table } from 'dexie'
import type {
  Annotation,
  AnnotationAnchor,
  AppStateRow,
  Asset,
  Book,
  Bookmark,
  CommentaryLayer,
  DocumentBlob,
  DocumentMeta,
  Lesson,
  LibraryBlock,
  LibraryNode,
  LibraryPage,
  Note,
  NoteDoc,
  NoteLink,
  OutlineNode,
  OcrResult,
  PageMark,
  PageRecord,
  PdfNoteLink,
  QuoteRef,
  ReadingState,
  Subject,
} from '@/types'

/**
 * The one and only IndexedDB database.
 *
 * Two deliberate shapes here:
 *
 *  1. Bytes live apart from metadata (`documentBlobs`, `noteDocs`). Listing the
 *     library must never deserialise a 40 MB PDF or 400 ProseMirror documents.
 *
 *  2. Phase-2 tables (layers, bookmarks, lessons) are declared in v1 even though
 *     nothing writes to them yet, so turning those features on later is a code
 *     change rather than a migration on a user's only copy of their notes.
 */
export class HashiyahDB extends Dexie {
  subjects!: Table<Subject, string>
  books!: Table<Book, string>
  documents!: Table<DocumentMeta, string>
  documentBlobs!: Table<DocumentBlob, string>
  pages!: Table<PageRecord, string>
  outlineNodes!: Table<OutlineNode, string>
  annotations!: Table<Annotation, string>
  anchors!: Table<AnnotationAnchor, string>
  notes!: Table<Note, string>
  noteDocs!: Table<NoteDoc, string>
  quoteRefs!: Table<QuoteRef, string>
  readingStates!: Table<ReadingState, string>
  appState!: Table<AppStateRow, string>
  layers!: Table<CommentaryLayer, string>
  bookmarks!: Table<Bookmark, string>
  lessons!: Table<Lesson, string>
  noteLinks!: Table<NoteLink, string>
  assets!: Table<Asset, string>
  libraryNodes!: Table<LibraryNode, string>
  libraryPages!: Table<LibraryPage, string>
  libraryBlocks!: Table<LibraryBlock, string>
  pageMarks!: Table<PageMark, string>
  ocrResults!: Table<OcrResult, string>
  pdfNoteLinks!: Table<PdfNoteLink, string>

  constructor(name = 'hashiyah') {
    super(name)
    this.version(1).stores({
      subjects: 'id, parentId, order',
      books: 'id, subjectId, order, lastOpenedAt, favorite, *tags',
      documents: 'id, bookId, fingerprint',
      documentBlobs: 'documentId',
      pages: 'id, documentId, [documentId+pageNumber]',
      outlineNodes: 'id, bookId, parentId, order',
      annotations: 'id, bookId, documentId, [documentId+pageNumber], createdAt, updatedAt',
      anchors: 'id, annotationId, documentId, [documentId+pageNumber]',
      notes: 'id, bookId, updatedAt, order',
      noteDocs: 'noteId',
      quoteRefs: 'id, noteId, annotationId',
      readingStates: 'bookId',
      appState: 'key',
      layers: 'id, bookId, order',
      bookmarks: 'id, bookId, [documentId+pageNumber]',
      lessons: 'id, bookId, date',
    })

    /**
     * v2 — additive only.
     *
     * Adds the `noteLinks` store (wiki-style `[[ ]]` references, derived from
     * note documents on save, exactly like quoteRefs) and a `lessonId` index on
     * `notes` so a lesson can list its own notes.
     *
     * Dexie carries every existing store and every existing row forward. Only
     * `notes` is re-declared, because changing a store's index list requires
     * restating it; its data is preserved and simply re-indexed. Nothing here
     * drops, clears or rewrites user content.
     */
    this.version(2).stores({
      notes: 'id, bookId, lessonId, updatedAt, order',
      noteLinks: 'id, sourceNoteId, targetType, targetId, [sourceNoteId+targetId]',
      assets: 'id, createdAt',
    })

    /**
     * v3 — additive only. Introduces the library tree (Phase E).
     *
     * `libraryNodes` sits *beside* `subjects` and `books` rather than replacing
     * them. A book node holds a `bookId` reference, so every existing PDF,
     * page, annotation and anchor keeps working untouched and nothing is
     * copied. `subjects` is left in place: it is still the shape older code
     * paths read, and dropping a table is not something to do for tidiness.
     *
     * Populating the tree is a separate, idempotent bootstrap step (see
     * `services/library/bootstrap.ts`) rather than an upgrade callback, so a
     * failure there can never leave a half-migrated schema behind.
     */
    this.version(3).stores({
      libraryNodes: 'id, parentId, type, order, bookId, noteId, favorite, lastOpenedAt',
    })

    /**
     * v4 — additive only. Introduces Library *pages* (a Notion-style block
     * editor) beside the existing study tree.
     *
     * `libraryNodes` is left untouched: notes, PDFs, books and the Study
     * sidebar continue to read it. Page blocks may *reference* a node via
     * `libraryNodeId`; they never copy or delete it. Filling pages is a
     * separate, idempotent migration (see `migrateLibraryPages.ts`), not an
     * upgrade callback.
     */
    this.version(4).stores({
      libraryPages: 'id, parentPageId, updatedAt',
      libraryBlocks: 'id, pageId, parentBlockId, [pageId+parentBlockId], libraryNodeId, order',
    })

    /**
     * v5 — additive only. PDF workspace marks (typed notes, area highlights,
     * freehand underlines) and a dedicated OCR cache. Existing `annotations`
     * and `anchors` are left untouched so snips and source backlinks keep
     * resolving.
     */
    this.version(5).stores({
      pageMarks: 'id, documentId, bookId, [documentId+pageNumber], createdAt',
      ocrResults: 'id, documentId, fingerprint, [documentId+pageNumber]',
    })

    /**
     * v6 — additive only. Bidirectional PDF ↔ note links.
     *
     * Companion PDF geometry stays on the existing `annotations`/`anchors`
     * tables (`kind: 'noteLink'`). This join table names the target by stable
     * note + block id, so renaming a heading cannot break the relationship and
     * existing quotes, snips and highlights are left untouched.
     */
    this.version(6).stores({
      pdfNoteLinks:
        'id, pdfDocumentId, noteDocumentId, noteBlockId, annotationId, [pdfDocumentId+pageNumber], [noteDocumentId+noteBlockId]',
    })

    /**
     * v7 — additive only. Indexes Book/PDF attachment references on library
     * page blocks. Existing rows keep their data; new `bookId` / `documentId`
     * fields are optional and never rewrite notes, PDFs or study nodes.
     */
    this.version(7).stores({
      libraryBlocks:
        'id, pageId, parentBlockId, [pageId+parentBlockId], libraryNodeId, bookId, documentId, order',
    })
  }
}

export const db = new HashiyahDB()

/**
 * Ask the browser not to evict the library under storage pressure. Called once
 * on first import. Failure is non-fatal — we surface it in Settings instead of
 * blocking the user.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  } catch {
    return null
  }
}
