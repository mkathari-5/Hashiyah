import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { libraryBlocksRepo, libraryPagesRepo, PREVIOUS_LIBRARY_PAGE_ID, ROOT_LIBRARY_PAGE_ID } from '@/db/repos/libraryPages'
import { libraryRepo } from '@/db/repos/libraryTree'
import { notesRepo } from '@/db/repos/notes'
import { appStateRepo } from '@/db/repos/session'
import {
  LIBRARY_PAGES_MIGRATION_KEY,
  LIBRARY_PAGES_MIGRATION_VERSION,
  migrateLibraryPages,
} from '@/features/library/migrateLibraryPages'
import { PREVIOUS_LIBRARY_TITLE } from '@/features/library/libraryPageModel'

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('library page migration', () => {
  it('runs once and imports study nodes under Previous Library without blanks', async () => {
    const science = await libraryRepo.create({
      parentId: null,
      type: 'science',
      title: 'Fiqh',
    })
    await db.books.add({
      id: 'bk_1',
      subjectId: null,
      title: 'Kitāb at-Taharah',
      language: 'ar',
      pageCount: 10,
      tags: [],
      favorite: false,
      order: 0,
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: null,
    })
    const book = await libraryRepo.create({
      parentId: science.id,
      type: 'book',
      title: 'Kitāb at-Taharah',
      bookId: 'bk_1',
    })
    const note = await notesRepo.create({ bookId: 'bk_1', title: 'Wudu notes' })
    const chapter = await libraryRepo.create({
      parentId: book.id,
      type: 'chapter',
      title: 'Wudu',
      noteId: note.id,
    })
    const leftover = await libraryRepo.create({
      parentId: book.id,
      type: 'chapter',
      title: '',
    })
    await libraryRepo.update(leftover.id, { title: '' })
    const untitled = await libraryRepo.create({
      parentId: book.id,
      type: 'chapter',
      title: 'Untitled',
    })

    const first = await migrateLibraryPages()
    expect(first.ran).toBe(true)
    expect(first.imported).toBeGreaterThan(0)

    const second = await migrateLibraryPages()
    expect(second.ran).toBe(false)

    expect(await appStateRepo.get(LIBRARY_PAGES_MIGRATION_KEY, 0)).toBe(LIBRARY_PAGES_MIGRATION_VERSION)

    const nodes = await libraryRepo.all()
    expect(nodes.find((n) => n.id === leftover.id)).toBeTruthy()
    expect(nodes.find((n) => n.id === untitled.id)?.title).toBe('Untitled')
    expect(nodes.find((n) => n.id === chapter.id)?.noteId).toBe(note.id)
    expect(nodes.find((n) => n.id === book.id)?.bookId).toBe('bk_1')

    const blocks = await libraryBlocksRepo.forPage(ROOT_LIBRARY_PAGE_ID)
    expect(blocks.every((b) => b.content !== 'Untitled' || b.libraryNodeId === untitled.id)).toBe(true)
    expect(blocks.some((b) => b.type === 'page' && b.content === PREVIOUS_LIBRARY_TITLE)).toBe(true)
    expect(blocks.some((b) => b.type === 'toggle' && b.content === PREVIOUS_LIBRARY_TITLE)).toBe(false)
    const archive = await libraryBlocksRepo.forPage(PREVIOUS_LIBRARY_PAGE_ID)
    const study = archive.filter((b) => b.type === 'study')
    expect(study.some((b) => b.libraryNodeId === chapter.id && b.content === 'Wudu')).toBe(true)
    expect(study.some((b) => b.libraryNodeId === leftover.id)).toBe(false)
    expect(study.filter((b) => !b.content.trim() && !b.libraryNodeId).length).toBe(0)
    expect(archive.filter((b) => b.type === 'toggle' && b.content === '')).toHaveLength(0)
  })

  it('leaves an empty Library page when there is nothing meaningful to import', async () => {
    const result = await migrateLibraryPages()
    expect(result.ran).toBe(true)
    expect(result.imported).toBe(0)
    const blocks = await libraryBlocksRepo.forPage(ROOT_LIBRARY_PAGE_ID)
    expect(blocks).toHaveLength(0)
    const page = await db.libraryPages.get(ROOT_LIBRARY_PAGE_ID)
    expect(page?.title).toBe('Library')
    expect(await db.libraryPages.get(PREVIOUS_LIBRARY_PAGE_ID)).toBeUndefined()
  })

  it('promotes a v1 Previous Library toggle into a page archive', async () => {
    await libraryPagesRepo.ensureRoot()
    await appStateRepo.set(LIBRARY_PAGES_MIGRATION_KEY, 1)
    const toggle = await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'toggle',
      content: PREVIOUS_LIBRARY_TITLE,
    })
    const node = await libraryRepo.create({ parentId: null, type: 'book', title: 'Umdat' })
    await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      parentBlockId: toggle.id,
      type: 'study',
      content: 'Umdat',
      libraryNodeId: node.id,
    })

    const result = await migrateLibraryPages()
    expect(result.ran).toBe(true)
    expect(await appStateRepo.get(LIBRARY_PAGES_MIGRATION_KEY, 0)).toBe(LIBRARY_PAGES_MIGRATION_VERSION)

    const root = await libraryBlocksRepo.forPage(ROOT_LIBRARY_PAGE_ID)
    expect(root.some((b) => b.type === 'page' && b.targetPageId === PREVIOUS_LIBRARY_PAGE_ID)).toBe(true)
    expect(root.some((b) => b.type === 'toggle')).toBe(false)
    const archive = await libraryBlocksRepo.forPage(PREVIOUS_LIBRARY_PAGE_ID)
    expect(archive.some((b) => b.content === 'Umdat' && b.parentBlockId === null && b.libraryNodeId === node.id)).toBe(
      true,
    )
  })
})
