import { db } from '@/db/db'
import { newId } from '@/lib/id'
import type { LibraryNode, LibraryNodeType } from '@/types'

/**
 * The library tree (Phase E).
 *
 * A node never owns a book's data — it references it. Deleting a chapter must
 * not be able to take a PDF with it, so removal here is explicit about what it
 * touches and leaves `books`, `documents` and `annotations` alone.
 */

export interface CreateNodeInput {
  parentId: string | null
  type: LibraryNodeType
  title: string
  arabicTitle?: string
  bookId?: string | null
  noteId?: string | null
  teacher?: string
  lessonNumber?: number
  pageStart?: number | null
  pageEnd?: number | null
}

export const libraryRepo = {
  all: () => db.libraryNodes.toArray(),
  get: (id: string) => db.libraryNodes.get(id),

  children: (parentId: string | null) =>
    db.libraryNodes
      .filter((n) => n.parentId === parentId)
      .toArray()
      .then((rows) => rows.sort((a, b) => a.order - b.order)),

  forBook: (bookId: string) => db.libraryNodes.where('bookId').equals(bookId).toArray(),

  recent: (limit = 5) =>
    db.libraryNodes
      .orderBy('lastOpenedAt')
      .reverse()
      .filter((n) => n.lastOpenedAt !== null)
      .limit(limit)
      .toArray(),

  favourites: () => db.libraryNodes.filter((n) => n.favorite === true).toArray(),

  async create(input: CreateNodeInput): Promise<LibraryNode> {
    const siblings = await libraryRepo.children(input.parentId)
    const now = Date.now()
    const node: LibraryNode = {
      id: newId('lib'),
      parentId: input.parentId,
      type: input.type,
      order: siblings.length,
      title: input.title,
      arabicTitle: input.arabicTitle,
      bookId: input.bookId ?? null,
      noteId: input.noteId ?? null,
      teacher: input.teacher,
      lessonNumber: input.lessonNumber,
      pageStart: input.pageStart ?? null,
      pageEnd: input.pageEnd ?? null,
      favorite: false,
      collapsed: true,
      lastOpenedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    await db.libraryNodes.add(node)
    return node
  },

  update: (id: string, patch: Partial<LibraryNode>) =>
    db.libraryNodes.update(id, { ...patch, updatedAt: Date.now() }),

  touch: (id: string) => db.libraryNodes.update(id, { lastOpenedAt: Date.now() }),

  /** Every descendant of `id`, deepest last. Used for moves and deletes. */
  async descendants(id: string): Promise<LibraryNode[]> {
    const all = await db.libraryNodes.toArray()
    const byParent = new Map<string | null, LibraryNode[]>()
    for (const node of all) {
      const list = byParent.get(node.parentId) ?? []
      list.push(node)
      byParent.set(node.parentId, list)
    }
    const out: LibraryNode[] = []
    const walk = (parentId: string) => {
      for (const child of byParent.get(parentId) ?? []) {
        out.push(child)
        walk(child.id)
      }
    }
    walk(id)
    return out
  },

  /**
   * Reorders `id` to sit at `index` among `parentId`'s children.
   * Rewrites the whole sibling run so orders stay dense and predictable.
   */
  async move(id: string, parentId: string | null, index: number) {
    await db.transaction('rw', db.libraryNodes, async () => {
      const node = await db.libraryNodes.get(id)
      if (!node) return

      // A node may never become its own ancestor.
      if (parentId) {
        const descendants = await libraryRepo.descendants(id)
        if (parentId === id || descendants.some((d) => d.id === parentId)) return
      }

      const siblings = (await libraryRepo.children(parentId)).filter((n) => n.id !== id)
      const at = Math.max(0, Math.min(index, siblings.length))
      siblings.splice(at, 0, { ...node, parentId })

      await Promise.all(
        siblings.map((sibling, order) =>
          db.libraryNodes.update(sibling.id, {
            parentId,
            order,
            updatedAt: Date.now(),
          }),
        ),
      )
    })
  },

  /**
   * Removes a node and its descendants from the *tree*.
   *
   * Books, PDFs and annotations are deliberately untouched: taking a chapter
   * out of the library should never destroy the book it pointed at. Notes
   * belonging purely to removed nodes are removed with them, which is what the
   * confirmation in the UI warns about.
   */
  async remove(id: string, options: { deleteNotes: boolean } = { deleteNotes: true }) {
    const doomed = [await db.libraryNodes.get(id), ...(await libraryRepo.descendants(id))].filter(
      (n): n is LibraryNode => !!n,
    )
    const ids = doomed.map((n) => n.id)
    const noteIds = doomed.map((n) => n.noteId).filter((n): n is string => !!n)

    await db.transaction('rw', db.libraryNodes, db.notes, db.noteDocs, db.quoteRefs, db.noteLinks, async () => {
      await db.libraryNodes.bulkDelete(ids)
      if (options.deleteNotes && noteIds.length) {
        await db.noteDocs.bulkDelete(noteIds)
        await db.notes.bulkDelete(noteIds)
        for (const noteId of noteIds) {
          await db.quoteRefs.where('noteId').equals(noteId).delete()
          await db.noteLinks.where('sourceNoteId').equals(noteId).delete()
        }
      }
    })
  },
}
