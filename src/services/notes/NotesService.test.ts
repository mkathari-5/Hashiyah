import { describe, expect, it } from 'vitest'
import {
  collectNoteLinks,
  collectOutline,
  collectQuoteRefs,
  countWords,
  deriveTitle,
  saveNote,
  NoteValidationError,
} from './NotesService'

const quote = (annotationId: string, blockId: string) => ({
  type: 'sourceQuote',
  attrs: { annotationId, blockId },
})

describe('collectQuoteRefs', () => {
  it('finds quotes at any depth, in document order', () => {
    const doc = {
      type: 'doc',
      content: [
        quote('ann_1', 'blk_1'),
        { type: 'paragraph', content: [{ type: 'text', text: 'explanation' }] },
        {
          type: 'semanticBlock',
          attrs: { kind: 'benefit' },
          content: [quote('ann_2', 'blk_2')],
        },
        {
          type: 'toggleBlock',
          content: [
            { type: 'toggleSummary' },
            { type: 'toggleContent', content: [quote('ann_3', 'blk_3')] },
          ],
        },
      ],
    }
    expect(collectQuoteRefs(doc, 'nt_1').map((r) => r.annotationId)).toEqual(['ann_1', 'ann_2', 'ann_3'])
    expect(collectQuoteRefs(doc, 'nt_1').map((r) => r.order)).toEqual([0, 1, 2])
  })

  it('lets one note reference several passages', () => {
    const doc = { type: 'doc', content: [quote('ann_1', 'blk_1'), quote('ann_2', 'blk_2')] }
    const refs = collectQuoteRefs(doc, 'nt_1')
    expect(new Set(refs.map((r) => r.annotationId)).size).toBe(2)
  })

  it('keeps two blocks quoting the same passage as separate refs', () => {
    const doc = { type: 'doc', content: [quote('ann_1', 'blk_1'), quote('ann_1', 'blk_2')] }
    expect(collectQuoteRefs(doc, 'nt_1')).toHaveLength(2)
  })

  it('ignores a duplicated block id rather than writing a colliding key', () => {
    const doc = { type: 'doc', content: [quote('ann_1', 'blk_1'), quote('ann_1', 'blk_1')] }
    expect(collectQuoteRefs(doc, 'nt_1')).toHaveLength(1)
  })

  it('survives a document with no quotes at all', () => {
    expect(collectQuoteRefs({ type: 'doc', content: [{ type: 'paragraph' }] }, 'nt_1')).toEqual([])
  })
})

describe('deriveTitle', () => {
  it('prefers the first heading', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'intro line' }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Millat Ibrāhīm' }] },
      ],
    }
    expect(deriveTitle(doc)).toBe('Millat Ibrāhīm')
  })

  it('falls back to the first paragraph', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'الحنيفية ملة إبراهيم' }] }],
    }
    expect(deriveTitle(doc)).toBe('الحنيفية ملة إبراهيم')
  })

  it('returns null for an empty note rather than an empty title', () => {
    expect(deriveTitle({ type: 'doc', content: [{ type: 'paragraph' }] })).toBeNull()
  })
})

describe('collectNoteLinks', () => {
  const link = (label: string, targetId: string | null) => ({
    type: 'wikiLink',
    attrs: { label, targetType: targetId ? 'note' : 'concept', targetId },
  })

  it('finds links inside nested blocks and records their owning block', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'blk_1' },
          content: [{ type: 'text', text: 'See ' }, link('Ḥanīfiyyah', null)],
        },
        {
          type: 'semanticBlock',
          attrs: { kind: 'benefit', blockId: 'blk_2' },
          content: [{ type: 'paragraph', content: [link('Kitāb at-Tawḥīd', 'bk_9')] }],
        },
      ],
    }
    const links = collectNoteLinks(doc, 'nt_1')
    expect(links).toHaveLength(2)
    expect(links[0]).toMatchObject({ label: 'Ḥanīfiyyah', targetId: null, blockId: 'blk_1' })
    expect(links[1]).toMatchObject({ label: 'Kitāb at-Tawḥīd', targetId: 'bk_9', blockId: 'blk_2' })
  })

  it('keeps an unresolved link rather than dropping what the user wrote', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'b' }, content: [link('Millat Ibrāhīm', null)] }] }
    expect(collectNoteLinks(doc, 'nt_1')[0].targetType).toBe('concept')
  })

  it('deduplicates the same label repeated in one block', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { blockId: 'b' }, content: [link('Tawḥīd', null), link('Tawḥīd', null)] }],
    }
    expect(collectNoteLinks(doc, 'nt_1')).toHaveLength(1)
  })
})

describe('collectOutline', () => {
  it('lists headings in order with their levels', () => {
    const heading = (level: number, text: string, blockId: string) => ({
      type: 'heading',
      attrs: { level, blockId },
      content: [{ type: 'text', text }],
    })
    const doc = {
      type: 'doc',
      content: [
        heading(1, 'Millat Ibrāhīm', 'b1'),
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
        heading(2, 'What is Ḥanīfiyyah?', 'b2'),
        heading(3, 'Evidence', 'b3'),
      ],
    }
    expect(collectOutline(doc)).toEqual([
      { blockId: 'b1', level: 1, text: 'Millat Ibrāhīm' },
      { blockId: 'b2', level: 2, text: 'What is Ḥanīfiyyah?' },
      { blockId: 'b3', level: 3, text: 'Evidence' },
    ])
  })

  it('skips empty headings rather than listing blanks', () => {
    const doc = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1, blockId: 'b' } }] }
    expect(collectOutline(doc)).toEqual([])
  })
})

describe('countWords', () => {
  it('counts Arabic and English alike', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hanifiyyah means turning away' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'الحنيفية ملة إبراهيم' }] },
      ],
    }
    expect(countWords(doc)).toBe(7)
  })

  it('is zero for an empty note', () => {
    expect(countWords({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(0)
  })
})

describe('saveNote', () => {
  it('refuses a malformed document instead of overwriting a good note', async () => {
    await expect(saveNote('nt_1', { type: 'not-a-doc' })).rejects.toBeInstanceOf(NoteValidationError)
    await expect(saveNote('nt_1', null)).rejects.toBeInstanceOf(NoteValidationError)
  })
})
