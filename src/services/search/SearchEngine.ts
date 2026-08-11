import { db } from '@/db/db'
import { mapRangeToSource, normalize, normalizeForSearch } from '@/lib/arabic'
import { navigationOutline } from '@/services/notes/NotesService'
import type { Annotation, Book, LibraryNode, PageRecord } from '@/types'

/**
 * SearchEngine.
 *
 * One query, several sources, grouped results (§28). Matching happens in
 * normalised space so `الحنيفية` finds `ٱلْحَنِيفِيَّة`, and every snippet is
 * then mapped *back* to the raw text so what you read in the results is the
 * original, diacritics and all.
 *
 * Implementation note: this is a scan over indexed page rows rather than an
 * inverted index. That is a deliberate MVP choice — Dexie streams rows and the
 * scan stays comfortably interactive into the tens of thousands of pages. The
 * interface is the thing that matters; swapping the internals for a token index
 * later changes nothing above this line.
 */

export type SearchScope = 'book' | 'library'

export interface SearchHit {
  id: string
  kind: 'page' | 'note' | 'annotation' | 'book' | 'node' | 'outline'
  bookId: string | null
  bookTitle: string
  pageNumber?: number
  noteId?: string
  annotationId?: string
  /** Library node to select when this result is chosen. */
  nodeId?: string
  /** Block within the note to scroll to — an outline entry's anchor. */
  blockId?: string
  /** Breadcrumb such as `Kitāb at-Tawḥīd › Chapter 3`. */
  path?: string
  /** Raw text around the match. */
  snippet: string
  /** Offsets of the match within `snippet`, for highlighting. */
  matchStart: number
  matchEnd: number
  rtl: boolean
}

export interface SearchResults {
  query: string
  library: SearchHit[]
  outline: SearchHit[]
  books: SearchHit[]
  pages: SearchHit[]
  notes: SearchHit[]
  annotations: SearchHit[]
  total: number
  truncated: boolean
}

const SNIPPET_PAD = 60
const PER_GROUP_LIMIT = 40

const EMPTY: SearchResults = {
  query: '',
  library: [],
  outline: [],
  books: [],
  pages: [],
  notes: [],
  annotations: [],
  total: 0,
  truncated: false,
}

function isRtl(text: string) {
  return /[؀-ۿݐ-ݿ]/.test(text)
}

/** Build a snippet around the first normalised match, in the *raw* text. */
function snippetFor(raw: string, needle: string): Omit<SearchHit, 'id' | 'kind' | 'bookId' | 'bookTitle'> | null {
  const norm = normalize(raw)
  const at = norm.text.indexOf(needle)
  if (at === -1) return null

  const [rawStart, rawEnd] = mapRangeToSource(norm, raw, at, at + needle.length)
  const from = Math.max(0, rawStart - SNIPPET_PAD)
  const to = Math.min(raw.length, rawEnd + SNIPPET_PAD)
  const snippet = (from > 0 ? '…' : '') + raw.slice(from, to).replace(/\s+/g, ' ') + (to < raw.length ? '…' : '')
  const lead = from > 0 ? 1 : 0

  return {
    snippet,
    matchStart: rawStart - from + lead,
    matchEnd: rawEnd - from + lead,
    rtl: isRtl(raw.slice(rawStart, rawEnd)),
  }
}

/** Flatten a ProseMirror document to plain text for searching. */
export function noteDocToText(doc: unknown): string {
  const parts: string[] = []
  const visit = (node: { type?: string; text?: string; content?: unknown[] }) => {
    if (!node || typeof node !== 'object') return
    if (typeof node.text === 'string') parts.push(node.text)
    if (Array.isArray(node.content)) {
      node.content.forEach((child) => visit(child as never))
      parts.push('\n')
    }
  }
  visit(doc as never)
  return parts.join(' ')
}

export async function search(
  rawQuery: string,
  scope: SearchScope,
  context: { bookId: string | null; documentId: string | null },
): Promise<SearchResults> {
  const needle = normalizeForSearch(rawQuery)
  if (needle.length < 2) return { ...EMPTY, query: rawQuery }

  const books = await db.books.toArray()
  const titleOf = new Map(books.map((b) => [b.id, b.title]))
  let truncated = false

  /** Set when the reader asked for "this book" and there is one to scope to. */
  const scopedBookId = scope === 'book' ? context.bookId : null

  // ── Books ────────────────────────────────────────────────────────────────
  const bookHits: SearchHit[] = books
    .filter((b: Book) => !scopedBookId || b.id === scopedBookId)
    .filter((b: Book) =>
      [b.title, b.arabicTitle, b.author, b.arabicAuthor]
        .filter(Boolean)
        .some((v) => normalizeForSearch(v!).includes(needle)),
    )
    .slice(0, 8)
    .map((b) => ({
      id: `book:${b.id}`,
      kind: 'book' as const,
      bookId: b.id,
      bookTitle: b.title,
      snippet: b.arabicTitle ? `${b.title} · ${b.arabicTitle}` : b.title,
      matchStart: 0,
      matchEnd: 0,
      rtl: false,
    }))

  // ── Book text ────────────────────────────────────────────────────────────
  const documentIds = new Set<string>()
  const documents = await db.documents.toArray()
  const bookOfDocument = new Map(documents.map((d) => [d.id, d.bookId]))
  if (scope === 'book' && context.documentId) documentIds.add(context.documentId)

  const pageHits: SearchHit[] = []
  const collectPage = (page: PageRecord) => {
    if (pageHits.length >= PER_GROUP_LIMIT) {
      truncated = true
      return
    }
    if (!page.normalizedText.includes(needle)) return
    const parts = snippetFor(page.text, needle)
    if (!parts) return
    const bookId = bookOfDocument.get(page.documentId) ?? null
    pageHits.push({
      id: `page:${page.id}`,
      kind: 'page',
      bookId,
      bookTitle: (bookId && titleOf.get(bookId)) || 'Unknown book',
      pageNumber: page.pageNumber,
      ...parts,
    })
  }

  if (scope === 'book' && context.documentId) {
    await db.pages.where('documentId').equals(context.documentId).each(collectPage)
  } else {
    await db.pages.each(collectPage)
  }

  // ── Annotations ──────────────────────────────────────────────────────────
  const annotationRows: Annotation[] =
    scope === 'book' && context.bookId
      ? await db.annotations.where('bookId').equals(context.bookId).toArray()
      : await db.annotations.toArray()

  const annotationHits: SearchHit[] = []
  for (const annotation of annotationRows) {
    if (annotationHits.length >= PER_GROUP_LIMIT) {
      truncated = true
      break
    }
    if (!annotation.normalizedText.includes(needle)) continue
    const parts = snippetFor(annotation.selectedText, needle)
    if (!parts) continue
    annotationHits.push({
      id: `ann:${annotation.id}`,
      kind: 'annotation',
      bookId: annotation.bookId,
      bookTitle: titleOf.get(annotation.bookId) ?? 'Unknown book',
      pageNumber: annotation.pageNumber,
      annotationId: annotation.id,
      ...parts,
    })
  }

  // ── Notes ────────────────────────────────────────────────────────────────
  const notes =
    scope === 'book' && context.bookId
      ? await db.notes.where('bookId').equals(context.bookId).toArray()
      : await db.notes.toArray()

  const noteHits: SearchHit[] = []
  for (const note of notes) {
    if (noteHits.length >= PER_GROUP_LIMIT) {
      truncated = true
      break
    }
    const row = await db.noteDocs.get(note.id)
    if (!row) continue
    const text = `${note.title}\n${noteDocToText(row.doc)}`
    if (!normalizeForSearch(text).includes(needle)) continue
    const parts = snippetFor(text, needle)
    if (!parts) continue
    noteHits.push({
      id: `note:${note.id}`,
      kind: 'note',
      bookId: note.bookId,
      bookTitle: (note.bookId && titleOf.get(note.bookId)) || 'Unfiled',
      noteId: note.id,
      ...parts,
    })
  }

  // ── Library tree and chapter outlines (§E26) ─────────────────────────────
  const { libraryHits, outlineHits } = await searchLibrary(needle, titleOf, scopedBookId)

  return {
    query: rawQuery,
    library: libraryHits,
    outline: outlineHits,
    books: bookHits,
    pages: pageHits,
    notes: noteHits,
    annotations: annotationHits,
    total:
      libraryHits.length +
      outlineHits.length +
      bookHits.length +
      pageHits.length +
      noteHits.length +
      annotationHits.length,
    truncated,
  }
}

/**
 * Sciences, books and chapters by title, and the headings and toggle titles
 * inside each chapter's notes.
 *
 * Outline entries are derived from the note documents themselves rather than
 * from a parallel index — the note is the source of truth, and a second copy of
 * every heading would only be one save away from being wrong.
 *
 * `scopedBookId` narrows the whole pass to one book. Scope has to be applied
 * here rather than by filtering results afterwards: a chapter carries no
 * `bookId` of its own, so which book an entry belongs to is a fact about the
 * tree, and only the tree can answer it (§E26).
 */
async function searchLibrary(
  needle: string,
  titleOf: Map<string, string>,
  scopedBookId: string | null,
): Promise<{ libraryHits: SearchHit[]; outlineHits: SearchHit[] }> {
  const all = await db.libraryNodes.toArray()
  const byId = new Map(all.map((n) => [n.id, n]))

  /**
   * The nearest book at or above a node — the same rule `resolveBookId` uses
   * when deciding which PDF a chapter shows, read from the nodes already in
   * memory rather than a query per node.
   */
  const bookOf = (node: LibraryNode): string | null => {
    let current: LibraryNode | undefined = node
    const seen = new Set<string>()
    while (current && !seen.has(current.id)) {
      if (current.bookId) return current.bookId
      seen.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    return null
  }

  const nodes = scopedBookId ? all.filter((node) => bookOf(node) === scopedBookId) : all

  /** `Kitāb at-Tawḥīd › Chapter 3` — where a result actually lives. */
  const pathOf = (node: LibraryNode): string => {
    const parts: string[] = []
    let current: LibraryNode | undefined = node
    const seen = new Set<string>()
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      // Same precedence as everywhere else in the app: an Arabic title is
      // something the reader typed, whereas `title` may still be the filename
      // a PDF happened to arrive with.
      parts.unshift(current.arabicTitle?.trim() || current.title)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    return parts.join(' › ')
  }

  const libraryHits: SearchHit[] = []
  for (const node of nodes) {
    if (libraryHits.length >= PER_GROUP_LIMIT) break
    const haystack = [node.title, node.arabicTitle].filter(Boolean).join(' ')
    if (!normalizeForSearch(haystack).includes(needle)) continue
    const parts = snippetFor(haystack, needle)
    if (!parts) continue
    // The *effective* book, for the same reason the scope uses it: a chapter
    // belongs to the book above it, and a result that claimed otherwise would
    // be describing a different library from the one it was searched in.
    const bookId = bookOf(node)
    libraryHits.push({
      id: `node:${node.id}`,
      kind: 'node',
      bookId,
      bookTitle: (bookId && titleOf.get(bookId)) || '',
      nodeId: node.id,
      noteId: node.noteId ?? undefined,
      path: pathOf(node),
      ...parts,
    })
  }

  const outlineHits: SearchHit[] = []
  for (const node of nodes) {
    if (outlineHits.length >= PER_GROUP_LIMIT) break
    if (!node.noteId) continue
    const row = await db.noteDocs.get(node.noteId)
    if (!row) continue
    const bookId = bookOf(node)

    for (const entry of navigationOutline(row.doc)) {
      if (outlineHits.length >= PER_GROUP_LIMIT) break
      if (!normalizeForSearch(entry.text).includes(needle)) continue
      const parts = snippetFor(entry.text, needle)
      if (!parts) continue
      outlineHits.push({
        id: `outline:${node.id}:${entry.blockId}`,
        kind: 'outline',
        bookId,
        bookTitle: (bookId && titleOf.get(bookId)) || '',
        nodeId: node.id,
        noteId: node.noteId,
        blockId: entry.blockId,
        path: pathOf(node),
        ...parts,
      })
    }
  }

  return { libraryHits, outlineHits }
}
