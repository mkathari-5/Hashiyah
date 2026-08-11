import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import { notesRepo } from '@/db/repos/notes'
import { ensureNodeNote } from '@/services/library/bootstrap'
import {
  applyToggleStates,
  collectNoteLinks,
  collectOutline,
  collectQuoteRefs,
  collectToggleStates,
  countWords,
  deriveTitle,
  navigationOutline,
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

const heading = (level: number, text: string, blockId: string) => ({
  type: 'heading',
  attrs: { level, blockId },
  content: [{ type: 'text', text }],
})

const toggle = (title: string, blockId: string, body: unknown[] = []) => ({
  type: 'toggleBlock',
  attrs: { blockId, open: true },
  content: [
    { type: 'toggleSummary', content: [{ type: 'text', text: title }] },
    { type: 'toggleContent', content: body.length ? body : [{ type: 'paragraph' }] },
  ],
})

describe('collectOutline', () => {
  it('lists headings in order with their levels', () => {
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
      { blockId: 'b1', kind: 'heading', level: 1, text: 'Millat Ibrāhīm' },
      { blockId: 'b2', kind: 'heading', level: 2, text: 'What is Ḥanīfiyyah?' },
      { blockId: 'b3', kind: 'heading', level: 3, text: 'Evidence' },
    ])
  })

  it('includes toggle titles and records their nesting depth', () => {
    const doc = {
      type: 'doc',
      content: [toggle('Benefits from this Āyah', 'b1', [toggle('Meaning of الاعتصام', 'b2')])],
    }
    expect(collectOutline(doc)).toEqual([
      { blockId: 'b1', kind: 'toggle', level: 0, text: 'Benefits from this Āyah' },
      { blockId: 'b2', kind: 'toggle', level: 1, text: 'Meaning of الاعتصام' },
    ])
  })

  it('reads only the toggle title, never its body', () => {
    const doc = {
      type: 'doc',
      content: [
        toggle('What is الرياء?', 'b1', [
          { type: 'paragraph', content: [{ type: 'text', text: 'A long answer nobody wants in the sidebar' }] },
        ]),
      ],
    }
    expect(collectOutline(doc).map((e) => e.text)).toEqual(['What is الرياء?'])
  })

  it('skips empty headings and untitled toggles rather than listing blanks', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1, blockId: 'b' } }, toggle('', 'b2')],
    }
    expect(collectOutline(doc)).toEqual([])
  })
})

describe('navigationOutline', () => {
  it('keeps headings and top-level toggles, and drops nested ones', () => {
    const doc = {
      type: 'doc',
      content: [
        heading(1, 'Chapter 3', 'h1'),
        toggle('Reason for this Chapter?', 't1'),
        toggle('Benefits from this Āyah', 't2', [toggle('Meaning of الاعتصام', 't3')]),
      ],
    }
    expect(navigationOutline(doc).map((e) => e.text)).toEqual([
      'Chapter 3',
      'Reason for this Chapter?',
      'Benefits from this Āyah',
    ])
  })

  it('leaves study blocks and quotations out of the sidebar entirely', () => {
    const doc = {
      type: 'doc',
      content: [
        toggle('What is الرياء?', 't1'),
        { type: 'semanticBlock', attrs: { kind: 'benefit', blockId: 's1' }, content: [{ type: 'paragraph' }] },
        { type: 'quranBlock', attrs: { blockId: 'q1' }, content: [{ type: 'text', text: 'إن إبراهيم كان أمة' }] },
        { type: 'sourceGroup', content: [{ type: 'sourceQuote', attrs: { annotationId: 'a', blockId: 'sq' } }, { type: 'paragraph' }] },
      ],
    }
    // The sidebar is navigation, not a second rendering of the note.
    expect(navigationOutline(doc).map((e) => e.text)).toEqual(['What is الرياء?'])
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

describe('collectToggleStates', () => {
  it('records every toggle by block id, at any depth', () => {
    const doc = {
      type: 'doc',
      content: [
        { ...toggle('A', 'a'), attrs: { blockId: 'a', open: true } },
        { ...toggle('B', 'b'), attrs: { blockId: 'b', open: false } },
        {
          ...toggle('C', 'c', [{ ...toggle('C nested', 'c1'), attrs: { blockId: 'c1', open: false } }]),
          attrs: { blockId: 'c', open: true },
        },
      ],
    }
    expect(collectToggleStates(doc)).toEqual({ a: true, b: false, c: true, c1: false })
  })

  it('treats a toggle with no explicit state as open, the way the schema does', () => {
    const doc = { type: 'doc', content: [{ ...toggle('A', 'a'), attrs: { blockId: 'a' } }] }
    expect(collectToggleStates(doc)).toEqual({ a: true })
  })
})

describe('applyToggleStates', () => {
  const doc = {
    type: 'doc',
    content: [
      { ...toggle('A', 'a'), attrs: { blockId: 'a', open: false } },
      { ...toggle('B', 'b'), attrs: { blockId: 'b', open: false } },
      { ...toggle('C', 'c'), attrs: { blockId: 'c', open: false } },
    ],
  }

  it('puts the reader’s own sections back, by block id', () => {
    const restored = applyToggleStates(doc, { a: true, b: false, c: true })
    expect(collectToggleStates(restored)).toEqual({ a: true, b: false, c: true })
  })

  it('leaves the document it was given alone', () => {
    applyToggleStates(doc, { a: true, b: true, c: true })
    expect(collectToggleStates(doc)).toEqual({ a: false, b: false, c: false })
  })

  it('leaves a toggle written since the snapshot as it is', () => {
    const withNew = { type: 'doc', content: [...doc.content, { ...toggle('D', 'd'), attrs: { blockId: 'd', open: false } }] }
    expect(collectToggleStates(applyToggleStates(withNew, { a: true }))).toEqual({
      a: true,
      b: false,
      c: false,
      d: false,
    })
  })

  it('changes nothing else — block ids, quotations and text all survive', () => {
    const source = {
      type: 'doc',
      content: [
        {
          ...toggle('A', 'a', [quote('ann_1', 'blk_q'), { type: 'paragraph', attrs: { blockId: 'p1' }, content: [{ type: 'text', text: 'الحنيفية' }] }]),
          attrs: { blockId: 'a', open: false },
        },
      ],
    }
    const restored = applyToggleStates(source, { a: true })
    expect(collectQuoteRefs(restored, 'nt_1')).toEqual(collectQuoteRefs(source, 'nt_1'))
    expect(JSON.stringify(restored).replace('"open":true', '"open":false')).toBe(JSON.stringify(source))
  })
})

describe('saveNote', () => {
  beforeEach(async () => {
    await Dexie.waitFor(db.open())
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('refuses a malformed document instead of overwriting a good note', async () => {
    await expect(saveNote('nt_1', { type: 'not-a-doc' })).rejects.toBeInstanceOf(NoteValidationError)
    await expect(saveNote('nt_1', null)).rejects.toBeInstanceOf(NoteValidationError)
  })

  /**
   * §E5 — the library owns identity, the note owns content.
   *
   * Writing "Evidence from the Qurʾān" as the first heading of Chapter 3 is
   * describing a section of that chapter. If that renamed the note, a reader
   * would watch their chapter list rewrite itself as they took notes.
   */
  it('does not rename a chapter’s note from a heading written inside it', async () => {
    const science = await libraryRepo.create({ parentId: null, type: 'science', title: 'ʿAqīdah' })
    const chapter = await libraryRepo.create({
      parentId: science.id,
      type: 'chapter',
      title: 'Chapter 3',
      arabicTitle: 'باب الخوف من الشرك',
    })
    const noteId = (await ensureNodeNote(chapter.id))!

    await saveNote(noteId, {
      type: 'doc',
      content: [heading(1, 'Evidence from the Qurʾān', 'h1')],
    })

    expect((await notesRepo.get(noteId))?.title).toBe('Chapter 3 — باب الخوف من الشرك')
    // And the library entry itself is untouched, as is the link between them.
    const after = await libraryRepo.get(chapter.id)
    expect(after?.title).toBe('Chapter 3')
    expect(after?.noteId).toBe(noteId)
  })

  it('keeps the quotation index for a chapter note it refuses to rename', async () => {
    const chapter = await libraryRepo.create({ parentId: null, type: 'chapter', title: 'Chapter 3' })
    const noteId = (await ensureNodeNote(chapter.id))!

    await saveNote(noteId, {
      type: 'doc',
      content: [heading(1, 'Evidence from the Qurʾān', 'h1'), quote('ann_1', 'blk_q')],
    })

    const refs = await db.quoteRefs.where('noteId').equals(noteId).toArray()
    expect(refs.map((r) => r.annotationId)).toEqual(['ann_1'])
    expect((await notesRepo.get(noteId))?.title).toBe('Chapter 3')
  })

  it('still names a standalone note from what is written in it', async () => {
    const note = await notesRepo.create({ bookId: null, title: 'Untitled note' })

    await saveNote(note.id, { type: 'doc', content: [heading(1, 'Millat Ibrāhīm', 'h1')] })

    expect((await notesRepo.get(note.id))?.title).toBe('Millat Ibrāhīm')
  })

  it('stops deriving a title the moment a note is filed in the library', async () => {
    const note = await notesRepo.create({ bookId: null, title: 'Untitled note' })
    await saveNote(note.id, { type: 'doc', content: [heading(1, 'Millat Ibrāhīm', 'h1')] })

    await libraryRepo.create({ parentId: null, type: 'notes', title: 'Millat Ibrāhīm', noteId: note.id })
    await saveNote(note.id, { type: 'doc', content: [heading(1, 'Something else entirely', 'h1')] })

    expect((await notesRepo.get(note.id))?.title).toBe('Millat Ibrāhīm')
  })
})
