import type { Book } from '@/types'

/**
 * What a book should be called on screen (§45).
 *
 * The rule: a book's *title* is what the reader calls it, never the filename
 * the PDF happened to arrive with. Arabic works are named in Arabic — showing
 * `منهج-معهد-تعليم-اللغة-العربية-المستوى-الثاني.pdf` across the top of the
 * application is both ugly and wrong.
 *
 * Precedence: Arabic title (for Arabic books) → title → filename stem.
 */
export function displayTitle(book: Pick<Book, 'title' | 'arabicTitle' | 'language'> | undefined | null): string {
  if (!book) return 'Untitled book'
  const arabic = book.arabicTitle?.trim()
  const latin = book.title?.trim()

  // An Arabic title is always something the reader deliberately typed, whereas
  // `title` is seeded from the filename at import. So the Arabic name wins
  // whenever it exists — that is the whole point of §45.
  if (arabic) return arabic
  return latin || 'Untitled book'
}

/** The other name, shown small beside the primary one — or nothing. */
export function secondaryTitle(
  book: Pick<Book, 'title' | 'arabicTitle' | 'language'> | undefined | null,
): string | null {
  if (!book) return null
  const primary = displayTitle(book)
  const arabic = book.arabicTitle?.trim()
  const latin = book.title?.trim()
  const other = primary === arabic ? latin : arabic
  return other && other !== primary ? other : null
}

/**
 * Turns a PDF filename into something a human would write, used only as the
 * initial suggestion in the import dialog. Strips the extension, separators,
 * duplicated whitespace and the download noise that tends to accumulate.
 */
export function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/-{2,}/g, ' ')
    .replace(/\s*\((?:\d+|copy)\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}
