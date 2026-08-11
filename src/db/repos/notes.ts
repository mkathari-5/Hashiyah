import { db } from '@/db/db'
import { ids } from '@/lib/id'
import type { Note, NoteLink, QuoteRef } from '@/types'

export const notesRepo = {
  get: (id: string) => db.notes.get(id),
  forBook: (bookId: string) => db.notes.where('bookId').equals(bookId).sortBy('order'),
  all: () => db.notes.toArray(),

  async create(input: { bookId: string | null; title?: string }): Promise<Note> {
    const now = Date.now()
    const count = input.bookId ? await db.notes.where('bookId').equals(input.bookId).count() : 0
    const note: Note = {
      id: ids.note(),
      bookId: input.bookId,
      title: input.title ?? 'Untitled note',
      outlineNodeId: null,
      lessonId: null,
      layerId: null,
      order: count,
      createdAt: now,
      updatedAt: now,
    }
    await db.transaction('rw', db.notes, db.noteDocs, async () => {
      await db.notes.add(note)
      await db.noteDocs.put({ noteId: note.id, doc: emptyDoc(), updatedAt: now })
    })
    return note
  },

  update: (id: string, patch: Partial<Note>) => db.notes.update(id, { ...patch, updatedAt: Date.now() }),

  async remove(id: string) {
    await db.transaction('rw', db.notes, db.noteDocs, db.quoteRefs, async () => {
      await db.noteDocs.delete(id)
      await db.quoteRefs.where('noteId').equals(id).delete()
      await db.notes.delete(id)
    })
  },
}

export const noteDocsRepo = {
  get: (noteId: string) => db.noteDocs.get(noteId),

  /**
   * Persists the document and re-derives both join indexes in the same
   * transaction, so neither can ever disagree with the document.
   */
  async save(
    noteId: string,
    doc: unknown,
    refs: Omit<QuoteRef, 'id'>[],
    links: Omit<NoteLink, 'id'>[] = [],
  ) {
    const now = Date.now()
    await db.transaction('rw', db.noteDocs, db.notes, db.quoteRefs, db.noteLinks, async () => {
      await db.noteDocs.put({ noteId, doc, updatedAt: now })
      await db.notes.update(noteId, { updatedAt: now })

      await db.quoteRefs.where('noteId').equals(noteId).delete()
      if (refs.length) {
        await db.quoteRefs.bulkPut(refs.map((r) => ({ ...r, id: `${r.noteId}:${r.blockId}` })))
      }

      await db.noteLinks.where('sourceNoteId').equals(noteId).delete()
      if (links.length) {
        await db.noteLinks.bulkPut(
          links.map((l) => ({ ...l, id: `${l.sourceNoteId}:${l.blockId}:${l.label}` })),
        )
      }
    })
  },
}

export const quoteRefsRepo = {
  forAnnotation: (annotationId: string) => db.quoteRefs.where('annotationId').equals(annotationId).toArray(),
  forNote: (noteId: string) => db.quoteRefs.where('noteId').equals(noteId).toArray(),
  forAnnotations: (annotationIds: string[]) =>
    db.quoteRefs.where('annotationId').anyOf(annotationIds).toArray(),
}

export const emptyDoc = () => ({
  type: 'doc',
  content: [{ type: 'paragraph' }],
})

export const newBlockId = () => ids.block()
