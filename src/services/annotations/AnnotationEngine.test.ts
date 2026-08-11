import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { notesRepo, noteDocsRepo } from '@/db/repos/notes'
import { pagesRepo } from '@/db/repos/documents'
import { normalizeForSearch } from '@/lib/arabic'
import { pageId } from '@/lib/id'
import { AnnotationEngine } from './AnnotationEngine'
import type { CapturedSelection } from './selection'
import { collectQuoteRefs } from '@/services/notes/NotesService'

/**
 * Integration tests against a real (in-memory) IndexedDB. These cover the
 * relationships the whole product rests on — the ones a pure unit test of the
 * resolver cannot reach.
 */

const PHRASE = 'الحنيفية ملة إبراهيم'
const PAGE_TEXT = `قال المصنف رحمه الله: ${PHRASE} وهي أن تعبد الله وحده. ثم أعاد: ${PHRASE} مرة أخرى.`

const DOC = 'doc_test'
const BOOK = 'bk_test'

function captureAt(occurrence: number): CapturedSelection {
  const first = PAGE_TEXT.indexOf(PHRASE)
  const start = occurrence === 0 ? first : PAGE_TEXT.indexOf(PHRASE, first + 1)
  const end = start + PHRASE.length
  return {
    pageNumber: 4,
    text: PHRASE,
    startOffset: start,
    endOffset: end,
    itemStart: 0,
    itemEnd: 0,
    textBefore: PAGE_TEXT.slice(Math.max(0, start - 64), start),
    textAfter: PAGE_TEXT.slice(end, end + 64),
    occurrenceIndex: occurrence,
    rects: [{ x: 0.2, y: 0.3, w: 0.5, h: 0.02 }],
    pageWidth: 595,
    pageHeight: 842,
    pageRotation: 0,
  }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  await pagesRepo.put({
    id: pageId(DOC, 4),
    documentId: DOC,
    pageNumber: 4,
    text: PAGE_TEXT,
    normalizedText: normalizeForSearch(PAGE_TEXT),
    itemOffsets: [0],
    width: 595,
    height: 842,
    rotation: 0,
    hasTextLayer: true,
    textSource: 'embedded',
    indexedAt: Date.now(),
  })
})

describe('AnnotationEngine', () => {
  it('writes an annotation and its anchor together, and resolves it exactly', async () => {
    const { annotation } = await AnnotationEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: captureAt(0),
      kind: 'explain',
    })

    expect(await db.anchors.where('annotationId').equals(annotation.id).count()).toBe(1)

    const resolved = await AnnotationEngine.resolve(annotation.id)
    expect(resolved?.resolution.strategy).toBe('exact')
    expect(resolved?.resolution.resolvedText).toBe(PHRASE)
  })

  it('stores the raw Arabic untouched alongside a normalised form', async () => {
    const vocalised = 'ٱلْحَنِيفِيَّةُ'
    const { annotation } = await AnnotationEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: { ...captureAt(0), text: vocalised },
      kind: 'explain',
    })
    const stored = await db.annotations.get(annotation.id)
    expect(stored!.selectedText).toBe(vocalised)
    expect(stored!.normalizedText).not.toBe(vocalised)
    expect(stored!.normalizedText).toBe(normalizeForSearch(PHRASE.split(' ')[0]))
  })

  it('keeps two annotations of the same sentence distinct', async () => {
    const a = await AnnotationEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: captureAt(0),
      kind: 'explain',
    })
    const b = await AnnotationEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: captureAt(1),
      kind: 'benefit',
    })

    const ra = await AnnotationEngine.resolve(a.annotation.id)
    const rb = await AnnotationEngine.resolve(b.annotation.id)
    expect(ra!.resolution.startOffset).not.toBe(rb!.resolution.startOffset)
    expect(ra!.resolution.strategy).toBe('exact')
    expect(rb!.resolution.strategy).toBe('exact')
  })

  it('lets several notes reference one passage', async () => {
    const { annotation } = await AnnotationEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: captureAt(0),
      kind: 'explain',
    })

    const first = await notesRepo.create({ bookId: BOOK, title: 'Lesson 1' })
    const second = await notesRepo.create({ bookId: BOOK, title: 'Lesson 2' })

    for (const [note, blockId] of [
      [first, 'blk_a'],
      [second, 'blk_b'],
    ] as const) {
      const doc = {
        type: 'doc',
        content: [{ type: 'sourceQuote', attrs: { annotationId: annotation.id, blockId } }],
      }
      await noteDocsRepo.save(note.id, doc, collectQuoteRefs(doc, note.id))
    }

    const notes = await AnnotationEngine.notesFor(annotation.id)
    expect(notes.map((n) => n.title).sort()).toEqual(['Lesson 1', 'Lesson 2'])
  })

  it('lets one note reference several passages', async () => {
    const a = await AnnotationEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: captureAt(0),
      kind: 'explain',
    })
    const b = await AnnotationEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: captureAt(1),
      kind: 'benefit',
    })

    const note = await notesRepo.create({ bookId: BOOK, title: 'Millat Ibrāhīm' })
    const doc = {
      type: 'doc',
      content: [
        { type: 'sourceQuote', attrs: { annotationId: a.annotation.id, blockId: 'blk_a' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'The author repeats the phrase.' }] },
        { type: 'sourceQuote', attrs: { annotationId: b.annotation.id, blockId: 'blk_b' } },
      ],
    }
    await noteDocsRepo.save(note.id, doc, collectQuoteRefs(doc, note.id))

    expect(await db.quoteRefs.where('noteId').equals(note.id).count()).toBe(2)
    expect((await AnnotationEngine.notesFor(a.annotation.id))[0].id).toBe(note.id)
    expect((await AnnotationEngine.notesFor(b.annotation.id))[0].id).toBe(note.id)
  })

  it('re-derives the quote index on every save, so removing a quote unlinks it', async () => {
    const { annotation } = await AnnotationEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: captureAt(0),
      kind: 'explain',
    })
    const note = await notesRepo.create({ bookId: BOOK, title: 'Notes' })

    const withQuote = {
      type: 'doc',
      content: [{ type: 'sourceQuote', attrs: { annotationId: annotation.id, blockId: 'blk_a' } }],
    }
    await noteDocsRepo.save(note.id, withQuote, collectQuoteRefs(withQuote, note.id))
    expect(await AnnotationEngine.notesFor(annotation.id)).toHaveLength(1)

    const without = { type: 'doc', content: [{ type: 'paragraph' }] }
    await noteDocsRepo.save(note.id, without, collectQuoteRefs(without, note.id))
    expect(await AnnotationEngine.notesFor(annotation.id)).toHaveLength(0)
  })

  it('deleting an annotation removes its anchor and links but never the note', async () => {
    const { annotation } = await AnnotationEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: captureAt(0),
      kind: 'explain',
    })
    const note = await notesRepo.create({ bookId: BOOK, title: 'Notes' })
    const doc = {
      type: 'doc',
      content: [{ type: 'sourceQuote', attrs: { annotationId: annotation.id, blockId: 'blk_a' } }],
    }
    await noteDocsRepo.save(note.id, doc, collectQuoteRefs(doc, note.id))

    await AnnotationEngine.remove(annotation.id)

    expect(await db.anchors.where('annotationId').equals(annotation.id).count()).toBe(0)
    expect(await db.quoteRefs.where('annotationId').equals(annotation.id).count()).toBe(0)
    expect(await notesRepo.get(note.id)).toBeDefined()
    expect(await noteDocsRepo.get(note.id)).toBeDefined()
  })

  it('resolves a whole page of annotations in one pass', async () => {
    await AnnotationEngine.create({ bookId: BOOK, documentId: DOC, capture: captureAt(0), kind: 'explain' })
    await AnnotationEngine.create({ bookId: BOOK, documentId: DOC, capture: captureAt(1), kind: 'highlight' })

    const resolved = await AnnotationEngine.resolveForPage(DOC, 4)
    expect(resolved).toHaveLength(2)
    expect(resolved.every((r) => r.resolution.confidence === 1)).toBe(true)
  })
})
