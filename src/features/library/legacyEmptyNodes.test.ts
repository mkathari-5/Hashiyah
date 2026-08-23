import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import { notesRepo } from '@/db/repos/notes'
import {
  isLegacyEmptyTitle,
  isSafeLegacyEmptyPlaceholder,
  purgeLegacyEmptyPlaceholders,
} from '@/features/library/legacyEmptyNodes'
import { bootstrapLibrary } from '@/services/library/bootstrap'
import type { LibraryNode } from '@/types'

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
})

function leaf(partial: Partial<LibraryNode> & Pick<LibraryNode, 'id' | 'title'>): LibraryNode {
  return {
    parentId: null,
    type: 'chapter',
    order: 0,
    favorite: false,
    collapsed: true,
    bookId: null,
    noteId: null,
    pageStart: null,
    pageEnd: null,
    lastOpenedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

describe('legacy empty-title placeholders', () => {
  it('does not treat a chosen title of Untitled as a leftover', () => {
    const node = leaf({ id: 'a', title: 'Untitled' })
    expect(isLegacyEmptyTitle(node)).toBe(false)
    expect(isSafeLegacyEmptyPlaceholder(node, 0)).toBe(false)
  })

  it('removes only empty contentless leaf placeholders', async () => {
    const science = await libraryRepo.create({
      parentId: null,
      type: 'science',
      title: 'ʿAqīdah',
    })
    const leftover = await libraryRepo.create({
      parentId: science.id,
      type: 'chapter',
      title: '   ',
    })
    await libraryRepo.update(leftover.id, { title: '' })

    const removed = await purgeLegacyEmptyPlaceholders()
    expect(removed).toBe(1)
    expect(await db.libraryNodes.get(leftover.id)).toBeUndefined()
    expect(await db.libraryNodes.get(science.id)).toBeTruthy()

    expect(await purgeLegacyEmptyPlaceholders()).toBe(0)
  })

  it('preserves empty-title records that contain notes, children, a book, or a chosen Untitled name', async () => {
    const science = await libraryRepo.create({
      parentId: null,
      type: 'science',
      title: 'Heart',
    })
    const note = await notesRepo.create({ bookId: null, title: 'Real notes' })
    const withNotes = await libraryRepo.create({
      parentId: science.id,
      type: 'chapter',
      title: '',
      noteId: note.id,
    })
    const parent = await libraryRepo.create({
      parentId: science.id,
      type: 'chapter',
      title: '',
    })
    const child = await libraryRepo.create({
      parentId: parent.id,
      type: 'chapter',
      title: 'Real child',
    })
    const named = await libraryRepo.create({
      parentId: science.id,
      type: 'chapter',
      title: 'Untitled',
    })
    const book = await libraryRepo.create({
      parentId: science.id,
      type: 'book',
      title: '',
      bookId: 'bk_keep',
    })

    const removed = await purgeLegacyEmptyPlaceholders()
    expect(removed).toBe(0)
    expect(await db.libraryNodes.get(withNotes.id)).toBeTruthy()
    expect(await db.libraryNodes.get(parent.id)).toBeTruthy()
    expect(await db.libraryNodes.get(child.id)).toBeTruthy()
    expect(await db.libraryNodes.get(named.id)).toBeTruthy()
    expect(await db.libraryNodes.get(book.id)).toBeTruthy()
  })

  it('bootstrap purge is idempotent and still seeds sciences', async () => {
    const leftover = await libraryRepo.create({
      parentId: null,
      type: 'chapter',
      title: '',
    })
    const first = await bootstrapLibrary()
    expect(first.purgedEmptyPlaceholders).toBe(1)
    expect(await db.libraryNodes.get(leftover.id)).toBeUndefined()

    const second = await bootstrapLibrary()
    expect(second.purgedEmptyPlaceholders).toBe(0)
    const sciences = (await libraryRepo.children(null)).filter((n) => n.type === 'science')
    expect(sciences.length).toBeGreaterThan(0)
  })
})
