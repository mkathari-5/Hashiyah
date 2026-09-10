import { booksRepo } from '@/db/repos/library'
import { documentsRepo } from '@/db/repos/documents'
import { libraryBlocksRepo, ROOT_LIBRARY_PAGE_ID } from '@/db/repos/libraryPages'
import { libraryRepo } from '@/db/repos/libraryTree'
import { readingStateRepo } from '@/db/repos/session'
import {
  childrenOf,
  isStructuralLibraryType,
  isTransientId,
} from '@/features/library/libraryPageModel'
import { ids } from '@/lib/id'
import { sha256 } from '@/lib/hash'
import { resolveBookId } from '@/services/library/bootstrap'
import type { Book, DocumentMeta, LibraryBlock, LibraryNode, LibraryNodeType } from '@/types'

export interface AttachPdfInput {
  bookId: string
  documentId?: string | null
  hostBlockId?: string | null
  pageId?: string
  /** When attaching at the root, create a titled toggle around the PDF block. */
  createHostToggle?: boolean
  hostTitle?: string
  /** Drop this empty slash/draft row after the attachment is created. */
  replaceBlockId?: string | null
}

export interface AttachPdfResult {
  block: LibraryBlock
  node: LibraryNode
  book: Book
  document: DocumentMeta | null
  host: LibraryBlock | null
}

export function hasBookDescendant(blockId: string, blocks: LibraryBlock[]): boolean {
  return childrenOf(blocks, blockId).some(
    (child) => child.type === 'book' || !!child.bookId || hasBookDescendant(child.id, blocks),
  )
}

export function ancestorBlocks(block: LibraryBlock, blocks: LibraryBlock[]): LibraryBlock[] {
  const out: LibraryBlock[] = []
  const seen = new Set<string>()
  let current = block.parentBlockId
  while (current && !seen.has(current)) {
    seen.add(current)
    const parent = blocks.find((row) => row.id === current)
    if (!parent) break
    out.push(parent)
    current = parent.parentBlockId
  }
  return out
}

export function nearestBookHost(block: LibraryBlock, blocks: LibraryBlock[]): LibraryBlock | null {
  if (block.type === 'book' || block.bookId) return block
  if (hasBookDescendant(block.id, blocks)) return block
  return ancestorBlocks(block, blocks).find((row) => row.type === 'book' || row.bookId || hasBookDescendant(row.id, blocks)) ?? null
}

/** Clicking this title should open the three-panel workspace, not start an edit. */
export function blockOpensStudyWorkspace(block: LibraryBlock, blocks: LibraryBlock[]): boolean {
  if (block.type === 'book') return true
  if (block.type === 'study' && block.libraryNodeId) return true
  if (!isStructuralLibraryType(block.type)) return false
  if (block.libraryNodeId || block.bookId) return true
  return !!nearestBookHost(block, blocks)
}

async function firstDocumentFor(bookId: string, preferredId?: string | null): Promise<DocumentMeta | null> {
  if (preferredId) {
    const preferred = await documentsRepo.get(preferredId)
    if (preferred && preferred.bookId === bookId) return preferred
  }
  const docs = await documentsRepo.forBook(bookId)
  return docs[0] ?? null
}

async function bookNodeFor(bookId: string): Promise<LibraryNode | null> {
  const nodes = await libraryRepo.forBook(bookId)
  return nodes.find((node) => node.type === 'book') ?? nodes[0] ?? null
}

function inferNodeType(
  block: LibraryBlock,
  parent: LibraryNode | null,
  isBookHost: boolean,
): LibraryNodeType {
  if (block.type === 'book' || isBookHost || block.bookId) return 'book'
  if (parent?.type === 'book') return 'chapter'
  if (parent && (parent.type === 'chapter' || parent.type === 'lesson' || parent.type === 'notes')) return 'notes'
  if (parent?.type === 'course') return 'lesson'
  return parent ? 'folder' : 'folder'
}

async function syncNodeTitle(node: LibraryNode, block: LibraryBlock): Promise<void> {
  const title = block.content.trim()
  if (!title || title === node.title) return
  await libraryRepo.update(node.id, { title, richTitle: block.richContent ?? node.richTitle })
}

/**
 * Create or reuse the LibraryNode that this homepage block represents.
 * Never matches by title — duplicate names keep distinct ids.
 */
export async function ensureLibraryNodeForBlock(
  blockId: string,
  pageBlocks?: LibraryBlock[],
): Promise<LibraryNode | null> {
  const block = await libraryBlocksRepo.get(blockId)
  if (!block || isTransientId(block.id)) return null
  const blocks = pageBlocks ?? (await libraryBlocksRepo.forPage(block.pageId))
  const isHost = block.type === 'book' || hasBookDescendant(block.id, blocks) || !!block.bookId

  if (block.libraryNodeId) {
    const existing = await libraryRepo.get(block.libraryNodeId)
    if (existing) {
      const parent = block.parentBlockId ? await ensureLibraryNodeForBlock(block.parentBlockId, blocks) : null
      const patch: Partial<LibraryNode> = {}
      if (parent && existing.parentId !== parent.id) patch.parentId = parent.id
      if (isHost && block.bookId && existing.bookId !== block.bookId) {
        patch.type = 'book'
        patch.bookId = block.bookId
      }
      if (Object.keys(patch).length) await libraryRepo.update(existing.id, patch)
      await syncNodeTitle(existing, block)
      return (await libraryRepo.get(existing.id)) ?? existing
    }
  }

  if (block.type === 'book') {
    if (block.parentBlockId) {
      const host = await ensureLibraryNodeForBlock(block.parentBlockId, blocks)
      if (host) {
        if (block.bookId && host.bookId !== block.bookId) {
          await libraryRepo.update(host.id, { type: 'book', bookId: block.bookId })
        }
        await libraryBlocksRepo.update(block.id, { libraryNodeId: host.id })
        return (await libraryRepo.get(host.id)) ?? host
      }
    }
    if (block.bookId) {
      const existing = await bookNodeFor(block.bookId)
      if (existing) {
        await libraryBlocksRepo.update(block.id, { libraryNodeId: existing.id })
        return existing
      }
    }
  }

  const parent = block.parentBlockId ? await ensureLibraryNodeForBlock(block.parentBlockId, blocks) : null
  const type = inferNodeType(block, parent, isHost)
  const title = block.content.trim() || 'Untitled'
  let node: LibraryNode | null = null
  if (type === 'book' && block.bookId) node = await bookNodeFor(block.bookId)
  if (node) {
    if (parent && node.parentId !== parent.id) await libraryRepo.update(node.id, { parentId: parent.id })
  } else {
    node = await libraryRepo.create({
      parentId: parent?.id ?? null,
      type,
      title,
      richTitle: block.richContent ?? null,
      bookId: type === 'book' ? block.bookId ?? null : null,
    })
  }
  await libraryBlocksRepo.update(block.id, { libraryNodeId: node.id })
  await syncNodeTitle(node, block)
  return (await libraryRepo.get(node.id)) ?? node
}

async function syncChapterChildren(host: LibraryBlock): Promise<void> {
  const blocks = await libraryBlocksRepo.forPage(host.pageId)
  for (const child of childrenOf(blocks, host.id)) {
    if (child.type === 'book' || !isStructuralLibraryType(child.type) || isTransientId(child.id)) continue
    await ensureLibraryNodeForBlock(child.id, blocks)
  }
}

export async function attachPdfToHost(input: AttachPdfInput): Promise<AttachPdfResult | null> {
  const book = await booksRepo.get(input.bookId)
  if (!book) return null
  const document = await firstDocumentFor(input.bookId, input.documentId)
  const pageId = input.pageId ?? ROOT_LIBRARY_PAGE_ID
  let host: LibraryBlock | null = input.hostBlockId ? (await libraryBlocksRepo.get(input.hostBlockId)) ?? null : null

  if (!host && input.createHostToggle !== false) {
    const title = input.hostTitle?.trim() || book.title
    host = await libraryBlocksRepo.create({
      pageId,
      parentBlockId: null,
      type: 'toggle',
      content: title,
      expanded: true,
      order: 0,
    })
  }

  if (host && isTransientId(host.id)) return null

  const hostBlock = host
  const existingOnHost = hostBlock
    ? (await libraryBlocksRepo.forPage(hostBlock.pageId)).find(
        (row) =>
          row.parentBlockId === hostBlock.id && row.type === 'book' && (row.bookId === book.id || !row.bookId),
      )
    : null

  const label = book.title
  let block: LibraryBlock
  if (existingOnHost) {
    await libraryBlocksRepo.update(existingOnHost.id, {
      type: 'book',
      content: existingOnHost.content.trim() || label,
      bookId: book.id,
      documentId: document?.id ?? null,
    })
    block = (await libraryBlocksRepo.get(existingOnHost.id)) ?? existingOnHost
  } else {
    block = await libraryBlocksRepo.create({
      pageId: host?.pageId ?? pageId,
      parentBlockId: host?.id ?? null,
      type: 'book',
      content: label,
      bookId: book.id,
      documentId: document?.id ?? null,
      order: 0,
    })
  }

  if (host) {
    await libraryBlocksRepo.update(host.id, { bookId: book.id, expanded: true })
    host = (await libraryBlocksRepo.get(host.id)) ?? host
  }

  const node = host
    ? await ensureLibraryNodeForBlock(host.id)
    : await ensureLibraryNodeForBlock(block.id)
  if (!node) return null
  await libraryRepo.update(node.id, { type: 'book', bookId: book.id })
  await libraryBlocksRepo.update(block.id, { libraryNodeId: node.id, bookId: book.id, documentId: document?.id ?? null })
  if (host) await libraryBlocksRepo.update(host.id, { libraryNodeId: node.id, bookId: book.id })
  if (host) await syncChapterChildren(host)

  if (input.replaceBlockId && input.replaceBlockId !== block.id && input.replaceBlockId !== host?.id) {
    const doomed = await libraryBlocksRepo.get(input.replaceBlockId)
    if (doomed && !doomed.content.trim() && doomed.type !== 'book') await libraryBlocksRepo.remove(doomed.id)
  }

  return {
    block: (await libraryBlocksRepo.get(block.id)) ?? block,
    node: (await libraryRepo.get(node.id)) ?? node,
    book,
    document,
    host,
  }
}

export async function attachUploadedPdf(input: {
  file: File
  hostBlockId?: string | null
  pageId?: string
  hostTitle?: string
  replaceBlockId?: string | null
  createHostToggle?: boolean
}): Promise<AttachPdfResult | null> {
  const { importPdf } = await import('@/services/pdf/importer')
  const imported = await importPdf(input.file, {
    subjectId: null,
    title: input.hostTitle,
  })
  return attachPdfToHost({
    bookId: imported.book.id,
    documentId: imported.document.id,
    hostBlockId: input.hostBlockId,
    pageId: input.pageId,
    hostTitle: input.hostTitle || imported.book.title,
    replaceBlockId: input.replaceBlockId,
    createHostToggle: input.createHostToggle,
  })
}

export async function storePdfForBook(bookId: string, file: File): Promise<DocumentMeta> {
  const { loadPdf } = await import('@/services/pdf/pdfjs')
  const bytes = await file.arrayBuffer()
  const fingerprint = await sha256(bytes)
  const { pageCount, destroy } = await loadPdf(bytes)
  await destroy()
  const document: DocumentMeta = {
    id: ids.document(),
    bookId,
    filename: file.name,
    byteLength: file.size,
    fingerprint,
    pageCount,
    createdAt: Date.now(),
  }
  await documentsRepo.add(document, file)
  await booksRepo.update(bookId, { pageCount })
  return document
}

export async function replacePdfForBlock(blockId: string, file: File): Promise<AttachPdfResult | null> {
  const block = await libraryBlocksRepo.get(blockId)
  if (!block) return null
  const bookId = block.bookId ?? (block.libraryNodeId ? (await libraryRepo.get(block.libraryNodeId))?.bookId : null)
  if (!bookId) {
    return attachUploadedPdf({
      file,
      hostBlockId: block.parentBlockId,
      pageId: block.pageId,
      replaceBlockId: block.id,
      createHostToggle: !block.parentBlockId,
    })
  }
  const document = await storePdfForBook(bookId, file)
  await libraryBlocksRepo.update(block.id, { documentId: document.id, bookId })
  const attached = await attachPdfToHost({
    bookId,
    documentId: document.id,
    hostBlockId: block.parentBlockId,
    pageId: block.pageId,
    createHostToggle: false,
  })
  return attached
}

export async function detachPdfFromBlock(blockId: string): Promise<void> {
  const block = await libraryBlocksRepo.get(blockId)
  if (!block) return
  const bookId = block.bookId
  await libraryBlocksRepo.update(block.id, { bookId: null, documentId: null })
  if (block.libraryNodeId) {
    const node = await libraryRepo.get(block.libraryNodeId)
    if (node?.bookId && node.bookId === bookId) await libraryRepo.update(node.id, { bookId: null })
  }
  if (block.parentBlockId) {
    const host = await libraryBlocksRepo.get(block.parentBlockId)
    if (host && host.bookId === bookId) await libraryBlocksRepo.update(host.id, { bookId: null })
  }
}

export async function inheritedBookIdForBlock(blockId: string): Promise<string | null> {
  const block = await libraryBlocksRepo.get(blockId)
  if (!block) return null
  if (block.bookId) return block.bookId
  if (block.libraryNodeId) {
    const node = await libraryRepo.get(block.libraryNodeId)
    if (node) return resolveBookId(node)
  }
  if (block.parentBlockId) return inheritedBookIdForBlock(block.parentBlockId)
  return null
}

export async function listStoredPdfs(): Promise<{ book: Book; document: DocumentMeta | null; lastPage: number | null }[]> {
  const books = await booksRepo.all()
  const out: { book: Book; document: DocumentMeta | null; lastPage: number | null }[] = []
  for (const book of books.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || a.title.localeCompare(b.title))) {
    const document = (await documentsRepo.forBook(book.id))[0] ?? null
    const state = await readingStateRepo.get(book.id)
    out.push({ book, document, lastPage: state?.pageNumber ?? null })
  }
  return out
}

export async function listHomepageSections(pageId = ROOT_LIBRARY_PAGE_ID): Promise<LibraryBlock[]> {
  const blocks = await libraryBlocksRepo.forPage(pageId)
  return blocks.filter((block) => isStructuralLibraryType(block.type) && block.type !== 'book')
}

export async function pdfStatusForBlock(block: Pick<LibraryBlock, 'bookId' | 'documentId'>): Promise<{
  book: Book | null
  document: DocumentMeta | null
  lastPage: number | null
  missingFile: boolean
}> {
  const book = block.bookId ? ((await booksRepo.get(block.bookId)) ?? null) : null
  const document = block.documentId
    ? ((await documentsRepo.get(block.documentId)) ?? null)
    : book
      ? ((await documentsRepo.forBook(book.id))[0] ?? null)
      : null
  const lastPage = book ? ((await readingStateRepo.get(book.id))?.pageNumber ?? null) : null
  const blob = document ? await documentsRepo.blob(document.id) : null
  return { book, document, lastPage, missingFile: !!document && !blob }
}
