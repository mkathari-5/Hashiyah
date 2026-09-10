import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { libraryBlocksRepo, libraryPagesRepo, ROOT_LIBRARY_PAGE_ID } from '@/db/repos/libraryPages'
import { libraryRepo } from '@/db/repos/libraryTree'
import {
  attachPdfToHost,
  blockOpensStudyWorkspace,
  detachPdfFromBlock,
  ensureLibraryNodeForBlock,
  inheritedBookIdForBlock,
  pdfStatusForBlock,
} from '@/services/library/bookAttachment'
import type { Book } from '@/types'

async function seedBook(id: string, title: string): Promise<Book> {
  const book: Book = {
    id,
    subjectId: null,
    title,
    language: 'en',
    pageCount: 40,
    tags: [],
    favorite: false,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: null,
  }
  await db.books.add(book)
  await db.documents.add({
    id: `doc_${id}`,
    bookId: id,
    filename: `${id}.pdf`,
    byteLength: 4,
    fingerprint: `fp_${id}`,
    pageCount: 40,
    createdAt: 1,
  })
  return book
}

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
  await libraryPagesRepo.ensureRoot()
})

describe('Book/PDF attachments', () => {
  it('attaches an existing PDF to a host toggle and reuses the Book id', async () => {
    const book = await seedBook('bk_manhaj', 'Manhaj as-Salikeen')
    const host = await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'toggle',
      content: 'Manhaj as-Salikeen',
      expanded: true,
    })

    const result = await attachPdfToHost({
      bookId: book.id,
      documentId: 'doc_bk_manhaj',
      hostBlockId: host.id,
      createHostToggle: false,
    })

    expect(result?.node.bookId).toBe(book.id)
    expect(result?.block.bookId).toBe(book.id)
    expect(result?.block.documentId).toBe('doc_bk_manhaj')
    expect(result?.block.type).toBe('book')
    expect(result?.block.parentBlockId).toBe(host.id)
    expect(result?.block.order).toBe(0)

    const reloaded = await libraryBlocksRepo.forPage(ROOT_LIBRARY_PAGE_ID)
    const pdf = reloaded.find((row) => row.type === 'book')
    expect(pdf?.bookId).toBe(book.id)
    expect(pdf?.libraryNodeId).toBe(result?.node.id)
  })

  it('creates a host toggle when attaching at the root', async () => {
    const book = await seedBook('bk_root', 'Umdat')
    const result = await attachPdfToHost({
      bookId: book.id,
      documentId: 'doc_bk_root',
      createHostToggle: true,
      hostTitle: 'Umdat',
    })
    expect(result?.host?.type).toBe('toggle')
    expect(result?.host?.content).toBe('Umdat')
    expect(result?.block.parentBlockId).toBe(result?.host?.id)
  })

  it('keeps the PDF relationship after reload and rename', async () => {
    const book = await seedBook('bk_rename', 'Fiqh')
    const host = await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'toggle',
      content: 'Fiqh',
      expanded: true,
    })
    const first = await attachPdfToHost({ bookId: book.id, hostBlockId: host.id, createHostToggle: false })
    await libraryBlocksRepo.update(host.id, { content: 'Manhaj as-Salikeen' })
    await libraryRepo.update(first!.node.id, { title: 'Manhaj as-Salikeen' })

    const again = await libraryBlocksRepo.get(first!.block.id)
    expect(again?.bookId).toBe(book.id)
    expect(again?.documentId).toBe(first!.block.documentId)
    expect((await libraryRepo.get(first!.node.id))?.bookId).toBe(book.id)
  })

  it('lets two books share a title without mixing PDFs', async () => {
    await seedBook('bk_a', 'Fiqh')
    await seedBook('bk_b', 'Fiqh')
    const a = await attachPdfToHost({ bookId: 'bk_a', createHostToggle: true, hostTitle: 'Fiqh' })
    const b = await attachPdfToHost({ bookId: 'bk_b', createHostToggle: true, hostTitle: 'Fiqh' })
    expect(a?.node.id).not.toBe(b?.node.id)
    expect(a?.block.bookId).toBe('bk_a')
    expect(b?.block.bookId).toBe('bk_b')
  })

  it('inherits the parent book PDF for a nested chapter toggle', async () => {
    const book = await seedBook('bk_inherit', 'Manhaj as-Salikeen')
    const host = await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'toggle',
      content: 'Manhaj as-Salikeen',
      expanded: true,
    })
    await attachPdfToHost({ bookId: book.id, hostBlockId: host.id, createHostToggle: false })
    const chapter = await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      parentBlockId: host.id,
      type: 'toggle',
      content: 'Kitab at-Taharah',
    })
    const page = await libraryBlocksRepo.forPage(ROOT_LIBRARY_PAGE_ID)
    expect(blockOpensStudyWorkspace(chapter, page)).toBe(true)
    const node = await ensureLibraryNodeForBlock(chapter.id)
    expect(node?.type).toBe('chapter')
    expect(node?.parentId).toBe((await libraryRepo.get((await libraryBlocksRepo.get(host.id))!.libraryNodeId!))!.id)
    expect(await inheritedBookIdForBlock(chapter.id)).toBe(book.id)
  })

  it('unlinks a PDF block without deleting the Book or the host section', async () => {
    const book = await seedBook('bk_detach', 'Umdat')
    const host = await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'toggle',
      content: 'Umdat',
    })
    const attached = await attachPdfToHost({ bookId: book.id, hostBlockId: host.id, createHostToggle: false })
    await detachPdfFromBlock(attached!.block.id)
    expect(await db.books.get(book.id)).toBeDefined()
    expect(await libraryBlocksRepo.get(host.id)).toBeDefined()
    expect((await libraryBlocksRepo.get(attached!.block.id))?.bookId ?? null).toBeNull()
  })

  it('flags a stored PDF whose bytes are missing', async () => {
    const book = await seedBook('bk_missing', 'Broken scan')
    const host = await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'toggle',
      content: 'Broken scan',
      expanded: true,
    })
    const attached = await attachPdfToHost({ bookId: book.id, hostBlockId: host.id, createHostToggle: false })
    const status = await pdfStatusForBlock(attached!.block)
    expect(status.missingFile).toBe(true)
    expect(status.book?.id).toBe(book.id)
  })

  it('does not open ordinary writing toggles', async () => {
    const writing = await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'toggle',
      content: 'Scratch pad',
    })
    const page = await libraryBlocksRepo.forPage(ROOT_LIBRARY_PAGE_ID)
    expect(blockOpensStudyWorkspace(writing, page)).toBe(false)
  })
})
