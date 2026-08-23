import { db } from '@/db/db'
import { newId } from '@/lib/id'
import type { LibraryBlock, LibraryBlockType, LibraryPage } from '@/types'

/**
 * Library pages and their blocks.
 *
 * The study tree (`libraryNodes`) stays the source of truth for notes, PDFs
 * and the Study sidebar. These tables are the Notion-style page canvas: a
 * block may point at a node, but it never owns one.
 */

export const ROOT_LIBRARY_PAGE_ID = 'lpage_library_root'

export interface CreateBlockInput {
  id?: string
  pageId: string
  parentBlockId?: string | null
  type: LibraryBlockType
  content?: string
  order?: number
  expanded?: boolean
  checked?: boolean
  libraryNodeId?: string | null
}

function sortBlocks(rows: LibraryBlock[]): LibraryBlock[] {
  return [...rows].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

export const libraryPagesRepo = {
  get: (id: string) => db.libraryPages.get(id),

  async ensureRoot(): Promise<LibraryPage> {
    const existing = await db.libraryPages.get(ROOT_LIBRARY_PAGE_ID)
    if (existing) return existing
    const now = Date.now()
    const page: LibraryPage = {
      id: ROOT_LIBRARY_PAGE_ID,
      title: 'Library',
      parentPageId: null,
      createdAt: now,
      updatedAt: now,
    }
    try {
      await db.libraryPages.add(page)
    } catch {
      const raced = await db.libraryPages.get(ROOT_LIBRARY_PAGE_ID)
      if (raced) return raced
      throw new Error('Failed to create the root Library page')
    }
    return page
  },

  updateTitle: (id: string, title: string) =>
    db.libraryPages.update(id, { title, updatedAt: Date.now() }),
}

export const libraryBlocksRepo = {
  get: (id: string) => db.libraryBlocks.get(id),

  forPage: (pageId: string) =>
    db.libraryBlocks.where('pageId').equals(pageId).toArray().then(sortBlocks),

  children: (pageId: string, parentBlockId: string | null) =>
    db.libraryBlocks
      .where('pageId')
      .equals(pageId)
      .filter((block) => block.parentBlockId === parentBlockId)
      .toArray()
      .then(sortBlocks),

  async descendants(id: string): Promise<LibraryBlock[]> {
    const block = await db.libraryBlocks.get(id)
    if (!block) return []
    const all = await libraryBlocksRepo.forPage(block.pageId)
    const byParent = new Map<string | null, LibraryBlock[]>()
    for (const row of all) {
      const list = byParent.get(row.parentBlockId) ?? []
      list.push(row)
      byParent.set(row.parentBlockId, list)
    }
    const out: LibraryBlock[] = []
    const walk = (parentId: string) => {
      for (const child of byParent.get(parentId) ?? []) {
        out.push(child)
        walk(child.id)
      }
    }
    walk(id)
    return out
  },

  async create(input: CreateBlockInput): Promise<LibraryBlock> {
    const parentBlockId = input.parentBlockId ?? null
    const siblings = await libraryBlocksRepo.children(input.pageId, parentBlockId)
    const now = Date.now()
    const block: LibraryBlock = {
      id: input.id ?? newId('lblk'),
      pageId: input.pageId,
      parentBlockId,
      type: input.type,
      content: input.content ?? '',
      order: input.order ?? siblings.length,
      expanded: input.expanded ?? false,
      checked: input.checked,
      libraryNodeId: input.libraryNodeId ?? null,
      createdAt: now,
      updatedAt: now,
    }
    try {
      await db.libraryBlocks.add(block)
    } catch {
      const existing = await db.libraryBlocks.get(block.id)
      if (existing) return existing
      throw new Error('Failed to create a library block')
    }
    if (input.order != null && input.order !== siblings.length) {
      await libraryBlocksRepo.move(block.id, parentBlockId, input.order)
      return (await db.libraryBlocks.get(block.id)) ?? block
    }
    return block
  },

  update: (id: string, patch: Partial<LibraryBlock>) =>
    db.libraryBlocks.update(id, { ...patch, updatedAt: Date.now() }),

  async remove(id: string) {
    const doomed = [await db.libraryBlocks.get(id), ...(await libraryBlocksRepo.descendants(id))].filter(
      (row): row is LibraryBlock => !!row,
    )
    if (doomed.length === 0) return
    await db.libraryBlocks.bulkDelete(doomed.map((row) => row.id))
  },

  /**
   * Reorders `id` among `parentBlockId`'s children. Refuses to become its own
   * ancestor. Rewrites the sibling run so orders stay dense.
   */
  async move(id: string, parentBlockId: string | null, index: number) {
    await db.transaction('rw', db.libraryBlocks, async () => {
      const block = await db.libraryBlocks.get(id)
      if (!block) return

      if (parentBlockId) {
        if (parentBlockId === id) return
        const descendants = await libraryBlocksRepo.descendants(id)
        if (descendants.some((row) => row.id === parentBlockId)) return
      }

      const siblings = (await libraryBlocksRepo.children(block.pageId, parentBlockId)).filter(
        (row) => row.id !== id,
      )
      const at = Math.max(0, Math.min(index, siblings.length))
      siblings.splice(at, 0, { ...block, parentBlockId })

      await Promise.all(
        siblings.map((sibling, order) =>
          db.libraryBlocks.update(sibling.id, {
            parentBlockId,
            order,
            updatedAt: Date.now(),
          }),
        ),
      )
    })
  },
}
