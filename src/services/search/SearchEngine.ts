import { db } from '@/db/db'
import { mapRangeToSource, normalize, normalizeForSearch } from '@/lib/arabic'
import type { Annotation, Book, PageRecord } from '@/types'

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
  kind: 'page' | 'note' | 'annotation' | 'book'
  bookId: string | null
  bookTitle: string
  pageNumber?: number
  noteId?: string
  annotationId?: string
  /** Raw text around the match. */
  snippet: string
  /** Offsets of the match within `snippet`, for highlighting. */
  matchStart: number
  matchEnd: number
  rtl: boolean
}

export interface SearchResults {
  query: string
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

  // ── Books ────────────────────────────────────────────────────────────────
  const bookHits: SearchHit[] = books
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

  return {
    query: rawQuery,
    books: bookHits,
    pages: pageHits,
    notes: noteHits,
    annotations: annotationHits,
    total: bookHits.length + pageHits.length + noteHits.length + annotationHits.length,
    truncated,
  }
}
