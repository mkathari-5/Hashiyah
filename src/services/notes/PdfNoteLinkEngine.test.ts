import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { notesRepo } from '@/db/repos/notes'
import { pagesRepo } from '@/db/repos/documents'
import { libraryRepo } from '@/db/repos/libraryTree'
import { pdfNoteLinksRepo } from '@/db/repos/pdfNoteLinks'
import { normalizeForSearch } from '@/lib/arabic'
import { pageId } from '@/lib/id'
import { AnnotationEngine } from '@/services/annotations/AnnotationEngine'
import type { CapturedSelection } from '@/services/annotations/selection'
import { undoMarkHistory } from '@/services/annotations/history'
import { insertNamedToggleInDoc, listNoteTargets } from '@/services/notes/noteTargets'
import { saveNote } from '@/services/notes/NotesService'
import { PdfNoteLinkEngine } from '@/services/notes/PdfNoteLinkEngine'
import { defaultLabelPosition } from '@/services/notes/pdfNoteLinkGeometry'
import { registerLiveNoteEditor } from '@/services/notes/liveNoteEditor'
import { rotateRect } from '@/services/pdf/pageCoords'
import { useLibraryStore } from '@/state/useLibraryStore'
import { useNotesStore } from '@/state/useNotesStore'
import { useStudyStore } from '@/state/useStudyStore'

const BOOK = 'bk_tawhid'
const DOC = 'doc_tawhid'
const PHRASE = 'What came Regarding Ruqa (incantation) And Tamāʾim (Amulets)'
const ARABIC = 'شرح عنوان الباب'

const nativeCapture = (): CapturedSelection => ({
  pageNumber: 36,
  text: PHRASE,
  startOffset: 0,
  endOffset: PHRASE.length,
  itemStart: 0,
  itemEnd: 0,
  textBefore: '',
  textAfter: '',
  occurrenceIndex: 0,
  rects: [
    { x: 0.12, y: 0.18, w: 0.7, h: 0.03 },
    { x: 0.12, y: 0.21, w: 0.45, h: 0.03 },
  ],
  pageWidth: 595,
  pageHeight: 842,
  pageRotation: 0,
})

const ocrCapture = (): CapturedSelection => ({
  ...nativeCapture(),
  text: ARABIC,
  startOffset: 10,
  endOffset: 10 + ARABIC.length,
  rects: [{ x: 0.2, y: 0.4, w: 0.5, h: 0.025 }],
})

const regionCapture = (): CapturedSelection => ({
  pageNumber: 36,
  text: '',
  startOffset: 0,
  endOffset: 0,
  itemStart: 0,
  itemEnd: 0,
  textBefore: '',
  textAfter: '',
  occurrenceIndex: 0,
  rects: [{ x: 0.1, y: 0.15, w: 0.8, h: 0.08 }],
  pageWidth: 595,
  pageHeight: 842,
  pageRotation: 0,
})

const toggle = (title: string, blockId: string, body: unknown[] = [], open = true) => ({
  type: 'toggleBlock',
  attrs: { blockId, open, level: 0 },
  content: [
    { type: 'toggleSummary', content: [{ type: 'text', text: title }] },
    { type: 'toggleContent', content: body.length ? body : [{ type: 'paragraph', attrs: { blockId: `${blockId}_p` } }] },
  ],
})

async function seedChapter() {
  await db.books.add({
    id: BOOK,
    subjectId: null,
    title: 'Kitāb at-Tawḥīd',
    arabicTitle: 'كتاب التوحيد',
    language: 'ar',
    pageCount: 80,
    tags: [],
    favorite: false,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: null,
  })
  await db.documents.add({
    id: DOC,
    bookId: BOOK,
    filename: 'tawhid.pdf',
    byteLength: 4,
    fingerprint: 'fp',
    pageCount: 80,
    createdAt: 1,
  })
  await pagesRepo.put({
    id: pageId(DOC, 36),
    documentId: DOC,
    pageNumber: 36,
    text: PHRASE,
    normalizedText: normalizeForSearch(PHRASE),
    itemOffsets: [0],
    width: 595,
    height: 842,
    rotation: 0,
    hasTextLayer: true,
    textSource: 'embedded',
    indexedAt: 1,
  })
  const bookNode = await libraryRepo.create({ parentId: null, type: 'book', title: 'Kitāb at-Tawḥīd', bookId: BOOK })
  const chapter = await libraryRepo.create({
    parentId: bookNode.id,
    type: 'chapter',
    title: 'Chapter 7',
    pageStart: 36,
  })
  const note = await notesRepo.create({ bookId: BOOK, title: 'Chapter 7' })
  await libraryRepo.update(chapter.id, { noteId: note.id })
  await saveNote(note.id, {
    type: 'doc',
    content: [
      toggle('Chapter 7', 'blk_ch7', [
        {
          ...toggle('Explanation of Chapter Title', 'blk_expl', [
            { type: 'paragraph', attrs: { blockId: 'blk_expl_p' }, content: [{ type: 'text', text: 'The ruqyah and tamāʾim.' }] },
          ]),
          attrs: { blockId: 'blk_expl', open: false, level: 1 },
        },
        {
          ...toggle('Explanation of Chapter Title', 'blk_expl_dup', [
            { type: 'paragraph', attrs: { blockId: 'blk_dup_p' }, content: [{ type: 'text', text: 'A second section with the same title.' }] },
          ]),
          attrs: { blockId: 'blk_expl_dup', open: true, level: 1 },
        },
        {
          ...toggle(ARABIC, 'blk_ar', [{ type: 'paragraph', attrs: { blockId: 'blk_ar_p' }, content: [{ type: 'text', text: 'نص عربي' }] }]),
          attrs: { blockId: 'blk_ar', open: true, level: 1 },
        },
      ]),
    ],
  })
  return { note, chapter, bookNode }
}

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
  useStudyStore.setState({
    bookId: BOOK,
    documentId: DOC,
    currentPage: 36,
    zoom: 1.5,
    activeNoteId: null,
    selectedPdfNoteLinkId: null,
    linkDraft: null,
  })
  useLibraryStore.setState({ activeNodeId: null, hydrated: true })
  useNotesStore.setState({ pendingScroll: null })
})

describe('PdfNoteLinkEngine', () => {
  it('creates a link from native PDF text to an existing note block by id', async () => {
    const { note } = await seedChapter()
    const link = await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: nativeCapture(),
      textSource: 'embedded',
      anchorKind: 'text-selection',
      noteDocumentId: note.id,
      noteBlockId: 'blk_expl',
      libraryItemId: (await libraryRepo.owner(note.id))?.id ?? null,
    })
    expect(link.noteBlockId).toBe('blk_expl')
    expect(link.annotationId).toMatch(/^ann_/)
    expect(link.pageNumber).toBe(36)
    const annotation = await db.annotations.get(link.annotationId)
    expect(annotation?.kind).toBe('noteLink')
    expect(annotation?.selectedText).toBe(PHRASE)
    expect(annotation?.textSource).toBe('embedded')
    const anchor = await db.anchors.where('annotationId').equals(link.annotationId).first()
    expect(anchor?.rects).toHaveLength(2)
    const resolved = await PdfNoteLinkEngine.resolveLabel(link)
    expect(resolved.title).toBe('Explanation of Chapter Title')
    expect(resolved.missingTarget).toBe(false)
  })

  it('creates a link from OCR text and from a manual region', async () => {
    const { note } = await seedChapter()
    const ocr = await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: ocrCapture(),
      textSource: 'ocr',
      anchorKind: 'text-selection',
      noteDocumentId: note.id,
      noteBlockId: 'blk_ar',
    })
    expect((await db.annotations.get(ocr.annotationId))?.textSource).toBe('ocr')
    const resolved = await PdfNoteLinkEngine.resolveLabel(ocr)
    expect(resolved.title).toBe(ARABIC)

    const region = await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: regionCapture(),
      textSource: 'none',
      anchorKind: 'region',
      noteDocumentId: note.id,
      noteBlockId: 'blk_expl',
    })
    expect(region.anchorKind).toBe('region')
    expect((await db.anchors.where('annotationId').equals(region.annotationId).first())?.rects[0]?.w).toBe(0.8)
  })

  it('persists and restores the link after a simulated reload', async () => {
    const { note } = await seedChapter()
    const created = await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: nativeCapture(),
      anchorKind: 'text-selection',
      noteDocumentId: note.id,
      noteBlockId: 'blk_expl',
    })
    const restored = await pdfNoteLinksRepo.get(created.id)
    expect(restored).toMatchObject({
      id: created.id,
      noteBlockId: 'blk_expl',
      noteDocumentId: note.id,
      pdfDocumentId: DOC,
      pageNumber: 36,
    })
  })

  it('clicking the label requests the exact note and block without resetting the PDF', async () => {
    const { note, chapter } = await seedChapter()
    useStudyStore.setState({ currentPage: 36, zoom: 1.5, bookId: BOOK, documentId: DOC, activeNoteId: 'nt_other' })
    const link = await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: nativeCapture(),
      anchorKind: 'text-selection',
      noteDocumentId: note.id,
      noteBlockId: 'blk_expl',
      libraryItemId: chapter.id,
    })
    await PdfNoteLinkEngine.revealNote(link)
    expect(useStudyStore.getState().currentPage).toBe(36)
    expect(useStudyStore.getState().zoom).toBe(1.5)
    expect(useStudyStore.getState().documentId).toBe(DOC)
    expect(useStudyStore.getState().activeNoteId).toBe(note.id)
    expect(useLibraryStore.getState().activeNodeId).toBe(chapter.id)
    expect(useNotesStore.getState().pendingScroll).toMatchObject({
      noteId: note.id,
      blockId: 'blk_expl',
    })
  })

  it('reverse navigation jumps to the stored annotation without rewriting the note', async () => {
    const { note } = await seedChapter()
    await saveNote(note.id, {
      type: 'doc',
      content: [toggle('Explanation of Chapter Title', 'blk_expl', [{ type: 'paragraph', content: [{ type: 'text', text: 'keep me' }] }])],
    })
    const link = await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: nativeCapture(),
      anchorKind: 'text-selection',
      noteDocumentId: note.id,
      noteBlockId: 'blk_expl',
    })
    const result = await PdfNoteLinkEngine.jumpToSource(link)
    expect(result).toBe('ok')
    expect(useStudyStore.getState().jumpRequest?.annotationId).toBe(link.annotationId)
    const doc = await db.noteDocs.get(note.id)
    expect(JSON.stringify(doc?.doc)).toContain('keep me')
  })

  it('synced labels follow a rename; custom labels do not', async () => {
    const { note } = await seedChapter()
    const synced = await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: nativeCapture(),
      anchorKind: 'text-selection',
      noteDocumentId: note.id,
      noteBlockId: 'blk_expl',
    })
    const custom = await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: ocrCapture(),
      textSource: 'ocr',
      anchorKind: 'text-selection',
      noteDocumentId: note.id,
      noteBlockId: 'blk_expl',
      labelMode: 'custom',
      customLabel: 'Explanation of Chapter Title',
    })
    await saveNote(note.id, {
      type: 'doc',
      content: [toggle('Detailed explanation from Shaykh al-Fawzān', 'blk_expl')],
    })
    expect((await PdfNoteLinkEngine.resolveLabel(synced)).title).toBe('Detailed explanation from Shaykh al-Fawzān')
    expect((await PdfNoteLinkEngine.resolveLabel(custom)).title).toBe('Explanation of Chapter Title')
    expect(custom.id).not.toBe(synced.id)
    expect((await pdfNoteLinksRepo.forBlock(note.id, 'blk_expl')).map((l) => l.id).sort()).toEqual(
      [synced.id, custom.id].sort(),
    )
  })

  it('allows several notes on one PDF region and several PDF sources on one note', async () => {
    const { note } = await seedChapter()
    const a = await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: nativeCapture(),
      anchorKind: 'text-selection',
      noteDocumentId: note.id,
      noteBlockId: 'blk_expl',
    })
    const b = await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: nativeCapture(),
      anchorKind: 'text-selection',
      noteDocumentId: note.id,
      noteBlockId: 'blk_ar',
    })
    const c = await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: regionCapture(),
      anchorKind: 'region',
      noteDocumentId: note.id,
      noteBlockId: 'blk_expl',
    })
    expect((await pdfNoteLinksRepo.forPage(DOC, 36)).length).toBe(3)
    expect((await pdfNoteLinksRepo.forBlock(note.id, 'blk_expl')).map((l) => l.id).sort()).toEqual([a.id, c.id].sort())
    expect((await pdfNoteLinksRepo.forBlock(note.id, 'blk_ar')).map((l) => l.id)).toEqual([b.id])
  })

  it('unlinks without deleting the note section', async () => {
    const { note } = await seedChapter()
    const link = await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: nativeCapture(),
      anchorKind: 'text-selection',
      noteDocumentId: note.id,
      noteBlockId: 'blk_expl',
    })
    await PdfNoteLinkEngine.unlink(link.id)
    expect(await pdfNoteLinksRepo.get(link.id)).toBeUndefined()
    expect(await db.annotations.get(link.annotationId)).toBeUndefined()
    expect(await db.notes.get(note.id)).toBeDefined()
    expect(JSON.stringify((await db.noteDocs.get(note.id))?.doc)).toContain('blk_expl')
  })

  it('removing a linked target deletes only the associated links', async () => {
    const { note } = await seedChapter()
    await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: nativeCapture(),
      anchorKind: 'text-selection',
      noteDocumentId: note.id,
      noteBlockId: 'blk_expl',
    })
    const kept = await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: regionCapture(),
      anchorKind: 'region',
      noteDocumentId: note.id,
      noteBlockId: 'blk_ar',
    })
    expect(await PdfNoteLinkEngine.countForBlocks(note.id, ['blk_expl'])).toBe(1)
    await PdfNoteLinkEngine.removeForBlocks(note.id, ['blk_expl'])
    expect(await pdfNoteLinksRepo.forBlock(note.id, 'blk_expl')).toHaveLength(0)
    expect(await pdfNoteLinksRepo.get(kept.id)).toBeDefined()
    expect(await db.notes.get(note.id)).toBeDefined()
  })

  it('shows a missing-note state instead of guessing by title', async () => {
    const { note } = await seedChapter()
    const link = await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: nativeCapture(),
      anchorKind: 'text-selection',
      noteDocumentId: note.id,
      noteBlockId: 'blk_expl',
    })
    await saveNote(note.id, {
      type: 'doc',
      content: [toggle('Explanation of Chapter Title', 'blk_unrelated')],
    })
    const resolved = await PdfNoteLinkEngine.resolveLabel(link)
    expect(resolved.missingTarget).toBe(true)
    expect(resolved.title).toBe('Missing note')
  })

  it('creates a new named section with a stable block id through persistence', async () => {
    const { note } = await seedChapter()
    const blockId = await PdfNoteLinkEngine.createNamedSection({
      noteId: note.id,
      title: 'Benefits',
      parentBlockId: 'blk_ch7',
    })
    const stored = await db.noteDocs.get(note.id)
    expect(JSON.stringify(stored?.doc)).toContain(blockId)
    expect(JSON.stringify(stored?.doc)).toContain('Benefits')
    const link = await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: nativeCapture(),
      anchorKind: 'text-selection',
      noteDocumentId: note.id,
      noteBlockId: blockId,
    })
    expect((await PdfNoteLinkEngine.resolveLabel(link)).title).toBe('Benefits')
  })

  it('inserts a new section through the live editor and flushes it to Dexie', async () => {
    const { note } = await seedChapter()
    let json: unknown = { type: 'doc', content: [toggle('Chapter 7', 'blk_ch7')] }
    const inserted: string[] = []
    const unreg = registerLiveNoteEditor({
      noteId: note.id,
      insertNamedToggle: (options) => {
        inserted.push(options.blockId)
        json = insertNamedToggleInDoc(json, options)
        return true
      },
      getJSON: () => json,
      flush: async () => {
        await saveNote(note.id, json)
      },
      applyJSON: (doc) => {
        json = doc
      },
    })
    try {
      const blockId = await PdfNoteLinkEngine.createNamedSection({
        noteId: note.id,
        title: 'Explanation of Chapter Title',
      })
      expect(inserted).toEqual([blockId])
      expect(JSON.stringify((await db.noteDocs.get(note.id))?.doc)).toContain('Explanation of Chapter Title')
      expect(JSON.stringify(json)).toContain(blockId)
    } finally {
      unreg()
    }
  })

  it('applies a Dexie insert onto the open editor when live insert fails', async () => {
    const { note } = await seedChapter()
    const stored = await db.noteDocs.get(note.id)
    let json: unknown = stored?.doc ?? { type: 'doc', content: [] }
    const unreg = registerLiveNoteEditor({
      noteId: note.id,
      insertNamedToggle: () => false,
      getJSON: () => json,
      flush: async () => {},
      applyJSON: (doc) => {
        json = doc
      },
    })
    try {
      const blockId = await PdfNoteLinkEngine.createNamedSection({
        noteId: note.id,
        title: 'Recovered section',
      })
      expect(JSON.stringify(json)).toContain(blockId)
      expect(JSON.stringify(json)).toContain('Recovered section')
      expect(JSON.stringify((await db.noteDocs.get(note.id))?.doc)).toContain(blockId)
    } finally {
      unreg()
    }
  })

  it('does not disturb existing captures and excerpts', async () => {
    const { note } = await seedChapter()
    const { annotation } = await AnnotationEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: nativeCapture(),
      kind: 'explain',
    })
    await saveNote(note.id, {
      type: 'doc',
      content: [
        { type: 'sourceQuote', attrs: { annotationId: annotation.id, blockId: 'blk_q' } },
        toggle('Explanation of Chapter Title', 'blk_expl'),
      ],
    })
    await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: regionCapture(),
      anchorKind: 'region',
      noteDocumentId: note.id,
      noteBlockId: 'blk_expl',
    })
    expect(await db.quoteRefs.where('annotationId').equals(annotation.id).count()).toBe(1)
    expect((await db.annotations.get(annotation.id))?.kind).toBe('explain')
    expect(JSON.stringify((await db.noteDocs.get(note.id))?.doc)).toContain('blk_q')
  })

  it('undo restores an unlinked relationship', async () => {
    const { note } = await seedChapter()
    const link = await PdfNoteLinkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: nativeCapture(),
      anchorKind: 'text-selection',
      noteDocumentId: note.id,
      noteBlockId: 'blk_expl',
    })
    await PdfNoteLinkEngine.unlink(link.id)
    expect(await pdfNoteLinksRepo.get(link.id)).toBeUndefined()
    await undoMarkHistory()
    expect(await pdfNoteLinksRepo.get(link.id)).toBeDefined()
    expect(await db.annotations.get(link.annotationId)).toBeDefined()
  })
})

describe('note target picker data', () => {
  it('searches Arabic and English, and distinguishes duplicate titles by block id', async () => {
    const { note, chapter } = await seedChapter()
    const english = await listNoteTargets({ bookId: BOOK, currentNoteId: note.id, query: 'Explanation of Chapter Title' })
    expect(english.filter((h) => h.title === 'Explanation of Chapter Title').map((h) => h.blockId).sort()).toEqual([
      'blk_expl',
      'blk_expl_dup',
    ])
    expect(english[0]?.breadcrumb.join(' › ')).toContain('Chapter 7')
    expect(english.every((h) => h.libraryItemId === chapter.id)).toBe(true)

    const arabic = await listNoteTargets({ bookId: BOOK, currentNoteId: note.id, query: 'شرح عنوان' })
    expect(arabic.some((h) => h.blockId === 'blk_ar')).toBe(true)
  })
})

describe('PDF note-link geometry', () => {
  it('places the label beside the source and keeps it under rotation', () => {
    const rects = [{ x: 0.1, y: 0.2, w: 0.4, h: 0.03 }]
    const pos = defaultLabelPosition(rects)
    expect(pos.x).toBeGreaterThan(0.5)
    expect(pos.y).toBe(0.2)
    const box = { x: pos.x, y: pos.y, w: 0.05, h: 0.02 }
    const roundTrip = rotateRect(rotateRect(box, 90), 270)
    expect(roundTrip.x).toBeCloseTo(box.x, 10)
    expect(roundTrip.y).toBeCloseTo(box.y, 10)
    expect(roundTrip.w).toBeCloseTo(box.w, 10)
    expect(roundTrip.h).toBeCloseTo(box.h, 10)
    const half = rotateRect(rotateRect(box, 180), 180)
    expect(half.x).toBeCloseTo(box.x, 10)
    expect(half.y).toBeCloseTo(box.y, 10)
  })
})
