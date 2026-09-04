import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { markHistory, redoMarkHistory, undoMarkHistory } from '@/services/annotations/history'
import { PageMarkEngine } from '@/services/annotations/PageMarkEngine'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  markHistory.clear()
})

describe('PageMarkEngine', () => {
  it('stores typed Arabic notes with size, colour and RTL direction', async () => {
    const mark = await PageMarkEngine.create({
      bookId: 'bk',
      documentId: 'doc',
      pageNumber: 2,
      rect: { x: 1.05, y: 0.2, w: 0.2, h: 0.08 },
      content: 'شرح لطيف',
      style: { fontSize: 22, color: '#3f5d4a', direction: 'rtl', align: 'start' },
      pageWidth: 595,
      pageHeight: 842,
    })
    expect(mark.kind).toBe('margin')
    const stored = await PageMarkEngine.get(mark.id)
    expect(stored?.content).toBe('شرح لطيف')
    expect(stored?.style.fontSize).toBe(22)
    expect(stored?.style.color).toBe('#3f5d4a')
    expect(stored?.style.direction).toBe('rtl')
  })

  it('keeps geometry in page space so zoom cannot drift it', async () => {
    const mark = await PageMarkEngine.create({
      bookId: 'bk',
      documentId: 'doc',
      pageNumber: 1,
      kind: 'area',
      rect: { x: 0.1, y: 0.2, w: 0.4, h: 0.05 },
      pageWidth: 595,
      pageHeight: 842,
    })
    const again = await PageMarkEngine.get(mark.id)
    expect(again?.rect).toEqual({ x: 0.1, y: 0.2, w: 0.4, h: 0.05 })
  })

  it('survives a virtualised page unmount because marks live on the document', async () => {
    await PageMarkEngine.create({
      bookId: 'bk',
      documentId: 'doc',
      pageNumber: 40,
      kind: 'line',
      rect: { x: 0.2, y: 0.8, w: 0.5, h: 0.01 },
      pageWidth: 595,
      pageHeight: 842,
    })
    const all = await PageMarkEngine.forDocument('doc')
    expect(all).toHaveLength(1)
    expect(all[0]?.pageNumber).toBe(40)
  })
})

describe('annotation undo stack', () => {
  it('undoes and redoes a created mark', async () => {
    const mark = await PageMarkEngine.create({
      bookId: 'bk',
      documentId: 'doc',
      pageNumber: 1,
      kind: 'area',
      content: 'x',
      rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      pageWidth: 100,
      pageHeight: 100,
    })
    const { recordMarkCreated } = await import('@/services/annotations/history')
    recordMarkCreated(mark)
    expect(await PageMarkEngine.get(mark.id)).toBeDefined()
    await undoMarkHistory()
    expect(await PageMarkEngine.get(mark.id)).toBeUndefined()
    await redoMarkHistory()
    expect(await PageMarkEngine.get(mark.id)).toBeDefined()
  })

  it('does not record an empty cancelled note', async () => {
    const mark = await PageMarkEngine.create({
      bookId: 'bk',
      documentId: 'doc',
      pageNumber: 1,
      rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.05 },
      content: '',
      pageWidth: 100,
      pageHeight: 100,
    })
    await PageMarkEngine.remove(mark.id)
    expect(markHistory.canUndo).toBe(false)
  })
})
