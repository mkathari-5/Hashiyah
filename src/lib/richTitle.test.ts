import { describe, expect, it } from 'vitest'
import {
  concatRichDocs,
  displayDoc,
  hasRichMarks,
  parseRichDoc,
  plainFromRich,
  richFromPlain,
  splitRichDoc,
} from '@/lib/richTitle'

describe('richTitle', () => {
  it('round-trips plain text', () => {
    const doc = richFromPlain('Kitab at-Taharah')
    expect(plainFromRich(doc)).toBe('Kitab at-Taharah')
    expect(hasRichMarks(doc)).toBe(false)
  })

  it('keeps partial bold and colour', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Kitab ', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'at-Taharah', marks: [{ type: 'textStyle', attrs: { color: '#8a6a3b' } }] },
          ],
        },
      ],
    }
    const parsed = parseRichDoc(doc)
    expect(plainFromRich(parsed)).toBe('Kitab at-Taharah')
    expect(hasRichMarks(parsed)).toBe(true)
  })

  it('drops scripts and unknown marks', () => {
    const parsed = parseRichDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
            { type: 'text', text: ' World', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    })
    expect(plainFromRich(parsed)).toBe('Hello World')
    expect(parsed?.content[0]?.content?.[0]?.marks).toBeUndefined()
    expect(parsed?.content[0]?.content?.[1]?.marks).toEqual([{ type: 'bold' }])
  })

  it('falls back to plain when rich text drifted', () => {
    const rich = richFromPlain('old')
    expect(plainFromRich(displayDoc('new', rich))).toBe('new')
  })

  it('splits and concatenates at a caret', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'World' },
          ],
        },
      ],
    }
    const { before, after } = splitRichDoc(doc, 6)
    expect(plainFromRich(before)).toBe('Hello ')
    expect(plainFromRich(after)).toBe('World')
    expect(plainFromRich(concatRichDocs(before, after))).toBe('Hello World')
    expect(hasRichMarks(before)).toBe(true)
    expect(hasRichMarks(after)).toBe(false)
  })

  it('treats missing rich documents as empty rather than throwing', () => {
    expect(parseRichDoc(undefined)).toBeNull()
    expect(parseRichDoc({ type: 'paragraph' })).toBeNull()
    expect(plainFromRich(null)).toBe('')
  })
})
