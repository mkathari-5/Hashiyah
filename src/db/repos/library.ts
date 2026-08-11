import { db } from '@/db/db'
import { ids } from '@/lib/id'
import type { Book, Subject } from '@/types'

export const subjectsRepo = {
  all: () => db.subjects.orderBy('order').toArray(),

  async create(input: { name: string; arabicName?: string; parentId?: string | null }): Promise<Subject> {
    const siblings = await db.subjects
      .filter((s) => s.parentId === (input.parentId ?? null))
      .toArray()
    const now = Date.now()
    const subject: Subject = {
      id: ids.subject(),
      parentId: input.parentId ?? null,
      name: input.name,
      arabicName: input.arabicName,
      order: siblings.length,
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    }
    await db.subjects.add(subject)
    return subject
  },

  update: (id: string, patch: Partial<Subject>) =>
    db.subjects.update(id, { ...patch, updatedAt: Date.now() }),

  /** Deletes a subject and re-parents its children and books to its own parent. */
  async remove(id: string) {
    await db.transaction('rw', db.subjects, db.books, async () => {
      const subject = await db.subjects.get(id)
      if (!subject) return
      const children = await db.subjects.where('parentId').equals(id).toArray()
      await Promise.all(children.map((c) => db.subjects.update(c.id, { parentId: subject.parentId })))
      const books = await db.books.where('subjectId').equals(id).toArray()
      await Promise.all(books.map((b) => db.books.update(b.id, { subjectId: subject.parentId })))
      await db.subjects.delete(id)
    })
  },
}

export const booksRepo = {
  all: () => db.books.toArray(),
  get: (id: string) => db.books.get(id),

  async create(input: Omit<Book, 'id' | 'order' | 'createdAt' | 'updatedAt' | 'lastOpenedAt'>): Promise<Book> {
    const now = Date.now()
    const count = await db.books.where('subjectId').equals(input.subjectId ?? '').count()
    const book: Book = {
      ...input,
      id: ids.book(),
      order: count,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
    }
    await db.books.add(book)
    return book
  },

  update: (id: string, patch: Partial<Book>) => db.books.update(id, { ...patch, updatedAt: Date.now() }),

  touch: (id: string) => db.books.update(id, { lastOpenedAt: Date.now() }),

  recent: (limit = 8) =>
    db.books
      .orderBy('lastOpenedAt')
      .reverse()
      .filter((b) => b.lastOpenedAt !== null)
      .limit(limit)
      .toArray(),

  /**
   * Removes a book and everything hanging off it. Notes are deleted too — they
   * have no meaning without their book — but this is only ever reached through
   * an explicit confirm in the UI.
   */
  async remove(id: string) {
    await db.transaction(
      'rw',
      [db.books, db.documents, db.documentBlobs, db.pages, db.outlineNodes, db.annotations, db.anchors, db.notes, db.noteDocs, db.quoteRefs, db.readingStates, db.bookmarks, db.layers, db.lessons],
      async () => {
        const docs = await db.documents.where('bookId').equals(id).toArray()
        for (const doc of docs) {
          await db.pages.where('documentId').equals(doc.id).delete()
          await db.documentBlobs.delete(doc.id)
        }
        await db.documents.where('bookId').equals(id).delete()

        const anns = await db.annotations.where('bookId').equals(id).toArray()
        for (const ann of anns) {
          await db.anchors.where('annotationId').equals(ann.id).delete()
          await db.quoteRefs.where('annotationId').equals(ann.id).delete()
        }
        await db.annotations.where('bookId').equals(id).delete()

        const notes = await db.notes.where('bookId').equals(id).toArray()
        for (const note of notes) {
          await db.noteDocs.delete(note.id)
          await db.quoteRefs.where('noteId').equals(note.id).delete()
        }
        await db.notes.where('bookId').equals(id).delete()

        await db.outlineNodes.where('bookId').equals(id).delete()
        await db.bookmarks.where('bookId').equals(id).delete()
        await db.layers.where('bookId').equals(id).delete()
        await db.lessons.where('bookId').equals(id).delete()
        await db.readingStates.delete(id)
        await db.books.delete(id)
      },
    )
  },
}
