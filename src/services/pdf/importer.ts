import { booksRepo } from '@/db/repos/library'
import { documentsRepo, outlineRepo, pagesRepo } from '@/db/repos/documents'
import { requestPersistentStorage } from '@/db/db'
import { normalizeForSearch, detectLanguage } from '@/lib/arabic'
import { ids, pageId } from '@/lib/id'
import { loadPdf } from '@/services/pdf/pdfjs'
import { buildPageText } from '@/services/pdf/pageText'
import type { Book, DocumentMeta, OutlineNode, PageRecord } from '@/types'
import { sha256 } from '@/lib/hash'

/**
 * Import pipeline.
 *
 * Two-phase on purpose. Phase one is everything needed to *open the book* —
 * hash, store bytes, read the page count and outline. Phase two is text
 * extraction, which for a 900-page scanned-then-OCR'd volume can take a while
 * and therefore runs page-by-page in the background, yielding to the event loop,
 * with the reader already usable. Nothing in the reading path waits on indexing.
 */

export type ImportStage = 'hashing' | 'opening' | 'storing' | 'ready' | 'indexing' | 'done' | 'error'

export interface ImportProgress {
  stage: ImportStage
  page?: number
  total?: number
  message?: string
}

export interface ImportResult {
  book: Book
  document: DocumentMeta
  duplicateOf?: DocumentMeta
}

export interface ImportOptions {
  subjectId: string | null
  title?: string
  arabicTitle?: string
  author?: string
  arabicAuthor?: string
  onProgress?: (p: ImportProgress) => void
}

function stripExtension(name: string) {
  return name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim()
}

export async function importPdf(file: File, options: ImportOptions): Promise<ImportResult> {
  const report = options.onProgress ?? (() => {})

  report({ stage: 'hashing' })
  const bytes = await file.arrayBuffer()
  const fingerprint = await sha256(bytes)

  const existing = await documentsRepo.byFingerprint(fingerprint)

  report({ stage: 'opening' })
  const { pdf, pageCount, destroy } = await loadPdf(bytes)

  // Read metadata from the PDF, but never let it block the import.
  let pdfTitle: string | undefined
  let pdfAuthor: string | undefined
  try {
    const info = (await pdf.getMetadata()).info as { Title?: string; Author?: string }
    pdfTitle = info?.Title?.trim() || undefined
    pdfAuthor = info?.Author?.trim() || undefined
  } catch {
    /* metadata is optional */
  }

  report({ stage: 'storing' })
  const title = options.title?.trim() || pdfTitle || stripExtension(file.name) || 'Untitled book'

  const book = await booksRepo.create({
    subjectId: options.subjectId,
    title,
    arabicTitle: options.arabicTitle,
    author: options.author ?? pdfAuthor,
    arabicAuthor: options.arabicAuthor,
    language: 'unknown',
    pageCount,
    tags: [],
    favorite: false,
  })

  const document: DocumentMeta = {
    id: ids.document(),
    bookId: book.id,
    filename: file.name,
    byteLength: file.size,
    fingerprint,
    pageCount,
    createdAt: Date.now(),
  }
  await documentsRepo.add(document, file)
  void requestPersistentStorage()

  await importOutline(pdf, book.id)
  report({ stage: 'ready', total: pageCount })

  await destroy()
  return { book, document, duplicateOf: existing ?? undefined }
}

type PdfDoc = Awaited<ReturnType<typeof loadPdf>>['pdf']

async function importOutline(pdf: PdfDoc, bookId: string) {
  let outline: Awaited<ReturnType<PdfDoc['getOutline']>>
  try {
    outline = await pdf.getOutline()
  } catch {
    return
  }
  if (!outline?.length) return

  const nodes: OutlineNode[] = []
  let order = 0

  const resolvePage = async (dest: unknown): Promise<number | null> => {
    try {
      const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
      if (!Array.isArray(explicit) || explicit.length === 0) return null
      const index = await pdf.getPageIndex(explicit[0] as never)
      return index + 1
    } catch {
      return null
    }
  }

  const walk = async (items: typeof outline, parentId: string | null, depth: number) => {
    if (depth > 6) return
    for (const item of items) {
      const id = ids.outline()
      nodes.push({
        id,
        bookId,
        parentId,
        title: item.title?.trim() || 'Untitled',
        pageNumber: await resolvePage(item.dest),
        order: order++,
        source: 'pdf',
      })
      if (item.items?.length) await walk(item.items, id, depth + 1)
    }
  }

  await walk(outline, null, 0)
  if (nodes.length) {
    await outlineRepo.clearForBook(bookId)
    await outlineRepo.putMany(nodes)
  }
}

export interface IndexHandle {
  promise: Promise<void>
  cancel: () => void
}

/**
 * Extract and index every page's text. Cancellable, resumable (already-indexed
 * pages are skipped), and yields between pages so typing never stutters.
 */
export function indexDocument(
  documentId: string,
  bookId: string,
  onProgress?: (p: ImportProgress) => void,
): IndexHandle {
  let cancelled = false
  const report = onProgress ?? (() => {})

  const promise = (async () => {
    const blob = await documentsRepo.blob(documentId)
    if (!blob) return
    const alreadyIndexed = await pagesRepo.countFor(documentId)
    const { pdf, pageCount, destroy } = await loadPdf(await blob.arrayBuffer())

    if (alreadyIndexed >= pageCount) {
      await destroy()
      report({ stage: 'done', page: pageCount, total: pageCount })
      return
    }

    const batch: PageRecord[] = []
    let sampled = ''
    let pagesWithText = 0

    try {
      for (let n = 1; n <= pageCount; n++) {
        if (cancelled) break
        if (await pagesRepo.get(documentId, n)) continue

        const page = await pdf.getPage(n)
        const viewport = page.getViewport({ scale: 1 })
        const content = await page.getTextContent()
        const { text, itemOffsets } = buildPageText(content.items as { str?: string; hasEOL?: boolean }[])
        const hasTextLayer = text.trim().length > 0
        if (hasTextLayer) pagesWithText++
        if (sampled.length < 4000) sampled += text.slice(0, 1200)

        batch.push({
          id: pageId(documentId, n),
          documentId,
          pageNumber: n,
          text,
          normalizedText: normalizeForSearch(text),
          itemOffsets,
          width: viewport.width,
          height: viewport.height,
          rotation: viewport.rotation,
          hasTextLayer,
          textSource: hasTextLayer ? 'embedded' : 'none',
          indexedAt: Date.now(),
        })
        page.cleanup()

        if (batch.length >= 8) {
          await pagesRepo.putMany(batch.splice(0))
        }
        report({ stage: 'indexing', page: n, total: pageCount })
        // Yield: keeps the reader and the editor responsive during import.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      if (batch.length) await pagesRepo.putMany(batch)

      if (!cancelled && sampled) {
        await booksRepo.update(bookId, { language: detectLanguage(sampled) })
      }
      report({ stage: cancelled ? 'ready' : 'done', total: pageCount })
    } finally {
      await destroy()
    }

    // Surfaced by the UI as an honest "no text layer" badge rather than a
    // broken selection experience. OCR is Phase 2.
    if (!cancelled && pagesWithText === 0 && pageCount > 0) {
      report({ stage: 'done', total: pageCount, message: 'no-text-layer' })
    }
  })()

  return { promise, cancel: () => (cancelled = true) }
}

