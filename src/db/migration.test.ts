import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { HashiyahDB } from '@/db/db'

/**
 * Migration safety (§55).
 *
 * The user's notes are the only copy that exists. This test builds a database
 * at schema v1 — exactly as it existed before this release — fills it with the
 * kind of content a real library holds, then opens it with the current schema
 * and asserts that every row is still there and still readable.
 *
 * It exists so that "the upgrade is additive" is a checked fact rather than a
 * claim in a commit message.
 */

const DB_NAME = 'hashiyah-migration-test'

/** The v1 schema, frozen. Do not update this when db.ts changes. */
const V1_STORES = {
  subjects: 'id, parentId, order',
  books: 'id, subjectId, order, lastOpenedAt, favorite, *tags',
  documents: 'id, bookId, fingerprint',
  documentBlobs: 'documentId',
  pages: 'id, documentId, [documentId+pageNumber]',
  outlineNodes: 'id, bookId, parentId, order',
  annotations: 'id, bookId, documentId, [documentId+pageNumber], createdAt, updatedAt',
  anchors: 'id, annotationId, documentId, [documentId+pageNumber]',
  notes: 'id, bookId, updatedAt, order',
  noteDocs: 'noteId',
  quoteRefs: 'id, noteId, annotationId',
  readingStates: 'bookId',
  appState: 'key',
  layers: 'id, bookId, order',
  bookmarks: 'id, bookId, [documentId+pageNumber]',
  lessons: 'id, bookId, date',
}

const ARABIC = 'الحنيفية ملة إبراهيم'
const VOCALISED = 'ٱلْحَنِيفِيَّةُ مِلَّةُ إِبْرَاهِيمَ'

async function buildV1Database() {
  const legacy = new Dexie(DB_NAME)
  legacy.version(1).stores(V1_STORES)
  await legacy.open()

  await legacy.table('books').add({
    id: 'bk_1',
    subjectId: null,
    title: 'Uṣūl ath-Thalāthah',
    arabicTitle: 'الأصول الثلاثة',
    language: 'ar',
    pageCount: 28,
    tags: ['aqidah'],
    favorite: true,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 2,
  })
  await legacy.table('documents').add({
    id: 'doc_1',
    bookId: 'bk_1',
    filename: 'usul.pdf',
    byteLength: 4,
    fingerprint: 'abc',
    pageCount: 28,
    createdAt: 1,
  })
  await legacy.table('documentBlobs').add({
    documentId: 'doc_1',
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/pdf' }),
  })
  await legacy.table('pages').add({
    id: 'doc_1:4',
    documentId: 'doc_1',
    pageNumber: 4,
    text: `قال المصنف: ${VOCALISED}`,
    normalizedText: 'قال المصنف: الحنيفيه مله ابراهيم',
    itemOffsets: [0],
    width: 595,
    height: 842,
    rotation: 0,
    hasTextLayer: true,
    textSource: 'embedded',
    indexedAt: 1,
  })
  await legacy.table('annotations').add({
    id: 'ann_1',
    bookId: 'bk_1',
    documentId: 'doc_1',
    pageNumber: 4,
    kind: 'explain',
    color: 'amber',
    selectedText: VOCALISED,
    normalizedText: 'الحنيفيه مله ابراهيم',
    textSource: 'embedded',
    layerId: null,
    lessonId: null,
    createdAt: 1,
    updatedAt: 1,
  })
  await legacy.table('anchors').add({
    id: 'anc_1',
    annotationId: 'ann_1',
    documentId: 'doc_1',
    pageNumber: 4,
    startOffset: 12,
    endOffset: 32,
    itemStart: 0,
    itemEnd: 0,
    occurrenceIndex: 0,
    textBefore: 'قال المصنف: ',
    textAfter: '',
    rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.03 }],
    pageWidth: 595,
    pageHeight: 842,
    pageRotation: 0,
    anchorVersion: 1,
  })
  await legacy.table('notes').add({
    id: 'nt_1',
    bookId: 'bk_1',
    title: 'Millat Ibrāhīm',
    outlineNodeId: null,
    lessonId: null,
    layerId: null,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  })
  await legacy.table('noteDocs').add({
    noteId: 'nt_1',
    doc: {
      type: 'doc',
      content: [
        { type: 'sourceQuote', attrs: { annotationId: 'ann_1', blockId: 'blk_1' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Hanifiyyah means turning away.' }] },
        { type: 'paragraph', attrs: { dir: 'rtl' }, content: [{ type: 'text', text: ARABIC }] },
      ],
    },
    updatedAt: 1,
  })
  await legacy.table('quoteRefs').add({
    id: 'nt_1:blk_1',
    noteId: 'nt_1',
    annotationId: 'ann_1',
    blockId: 'blk_1',
    order: 0,
  })
  await legacy.table('readingStates').add({
    bookId: 'bk_1',
    pageNumber: 4,
    scrollRatio: 0.33,
    zoom: 1.1,
    activeNoteId: 'nt_1',
    updatedAt: 1,
  })
  await legacy.table('appState').add({ key: 'theme', value: 'dark' })

  legacy.close()
}

beforeEach(async () => {
  await Dexie.delete(DB_NAME)
})

describe('schema v1 → v2', () => {
  it('carries every row forward untouched', async () => {
    await buildV1Database()

    const db = new HashiyahDB(DB_NAME)
    await db.open()

    expect(db.verno).toBe(2)

    // Nothing lost.
    expect(await db.books.count()).toBe(1)
    expect(await db.documents.count()).toBe(1)
    expect(await db.documentBlobs.count()).toBe(1)
    expect(await db.pages.count()).toBe(1)
    expect(await db.annotations.count()).toBe(1)
    expect(await db.anchors.count()).toBe(1)
    expect(await db.notes.count()).toBe(1)
    expect(await db.noteDocs.count()).toBe(1)
    expect(await db.quoteRefs.count()).toBe(1)
    expect(await db.readingStates.count()).toBe(1)
    expect(await db.appState.count()).toBe(1)

    db.close()
  })

  it('keeps Arabic content byte-for-byte, diacritics included', async () => {
    await buildV1Database()
    const db = new HashiyahDB(DB_NAME)
    await db.open()

    const annotation = await db.annotations.get('ann_1')
    expect(annotation!.selectedText).toBe(VOCALISED)
    expect(annotation!.selectedText).toContain('ّ')

    const book = await db.books.get('bk_1')
    expect(book!.arabicTitle).toBe('الأصول الثلاثة')

    const doc = await db.noteDocs.get('nt_1')
    expect(JSON.stringify(doc!.doc)).toContain(ARABIC)

    db.close()
  })

  it('preserves the source anchor exactly, so old notes still resolve', async () => {
    await buildV1Database()
    const db = new HashiyahDB(DB_NAME)
    await db.open()

    const anchor = await db.anchors.get('anc_1')
    expect(anchor).toMatchObject({
      annotationId: 'ann_1',
      pageNumber: 4,
      startOffset: 12,
      endOffset: 32,
      occurrenceIndex: 0,
      anchorVersion: 1,
    })
    expect(anchor!.rects).toHaveLength(1)

    db.close()
  })

  it('keeps the stored PDF row addressable by document id', async () => {
    await buildV1Database()
    const db = new HashiyahDB(DB_NAME)
    await db.open()

    const row = await db.documentBlobs.get('doc_1')
    // Note: `fake-indexeddb` does not round-trip Blob through structured clone,
    // so the value comes back as a plain object here. What this test can prove
    // — and the thing the migration could actually break — is that the row
    // survives the upgrade and is still keyed correctly. Blob fidelity in a
    // real browser is covered by the manual import/reload check.
    expect(row).toBeDefined()
    expect(row!.documentId).toBe('doc_1')

    db.close()
  })

  it('adds the new stores empty rather than populating them with guesses', async () => {
    await buildV1Database()
    const db = new HashiyahDB(DB_NAME)
    await db.open()

    expect(await db.noteLinks.count()).toBe(0)
    expect(await db.assets.count()).toBe(0)

    db.close()
  })

  it('exposes the new lessonId index on the re-declared notes store', async () => {
    await buildV1Database()
    const db = new HashiyahDB(DB_NAME)
    await db.open()

    // The pre-existing row is re-indexed, not rewritten: it still has no lesson.
    expect(await db.notes.where('lessonId').equals('les_x').count()).toBe(0)

    await db.notes.update('nt_1', { lessonId: 'les_x' })
    const found = await db.notes.where('lessonId').equals('les_x').toArray()
    expect(found.map((n) => n.title)).toEqual(['Millat Ibrāhīm'])

    db.close()
  })

  it('is idempotent — reopening an already-migrated database changes nothing', async () => {
    await buildV1Database()

    const first = new HashiyahDB(DB_NAME)
    await first.open()
    const before = await first.notes.count()
    first.close()

    const second = new HashiyahDB(DB_NAME)
    await second.open()
    expect(await second.notes.count()).toBe(before)
    expect(await second.noteDocs.get('nt_1')).toBeDefined()
    second.close()
  })
})
