import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { AnnotationEngine } from '@/services/annotations/AnnotationEngine'
import { PageMarkEngine } from '@/services/annotations/PageMarkEngine'
import { pagesRepo } from '@/db/repos/documents'
import { normalizeForSearch } from '@/lib/arabic'
import { pageId } from '@/lib/id'
import type { CapturedSelection } from '@/services/annotations/selection'

const DOC = 'doc_persist'
const BOOK = 'bk_persist'
const PHRASE = 'الحنيفية ملة إبراهيم'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  await pagesRepo.put({
    id: pageId(DOC, 1),
    documentId: DOC,
    pageNumber: 1,
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
})

function capture(): CapturedSelection {
  return {
    pageNumber: 1,
    text: PHRASE,
    startOffset: 0,
    endOffset: PHRASE.length,
    itemStart: 0,
    itemEnd: 0,
    textBefore: '',
    textAfter: '',
    occurrenceIndex: 0,
    rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.03 }],
    pageWidth: 595,
    pageHeight: 842,
    pageRotation: 0,
  }
}

describe('PDF workspace persistence', () => {
  it('keeps existing snips and source anchors when page marks are added', async () => {
    const snip = await AnnotationEngine.create({
      bookId: BOOK,
      documentId: DOC,
      capture: capture(),
      kind: 'explain',
    })
    await PageMarkEngine.create({
      bookId: BOOK,
      documentId: DOC,
      pageNumber: 1,
      kind: 'text',
      content: 'حاشية',
      style: { fontSize: 18, color: '#6b5344', direction: 'rtl', align: 'start' },
      rect: { x: -0.2, y: 0.2, w: 0.18, h: 0.08 },
      pageWidth: 595,
      pageHeight: 842,
    })

    expect(await db.annotations.get(snip.annotation.id)).toBeDefined()
    expect(await db.anchors.where('annotationId').equals(snip.annotation.id).count()).toBe(1)
    const resolved = await AnnotationEngine.resolve(snip.annotation.id)
    expect(resolved?.resolution.strategy).toBe('exact')
    expect((await PageMarkEngine.forDocument(DOC))[0]?.content).toBe('حاشية')
  })
})
