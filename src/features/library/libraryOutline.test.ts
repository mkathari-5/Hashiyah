import { describe, expect, it } from 'vitest'
import {
  canNestUnder,
  childTypeFor,
  isBlankTitle,
  previousSibling,
} from '@/features/library/libraryOutline'
import type { LibraryNode } from '@/types'

const node = (partial: Partial<LibraryNode> & Pick<LibraryNode, 'id' | 'type'>): LibraryNode => ({
  parentId: null,
  order: 0,
  title: '',
  favorite: false,
  collapsed: false,
  bookId: null,
  noteId: null,
  pageStart: null,
  pageEnd: null,
  lastOpenedAt: null,
  createdAt: 1,
  updatedAt: 1,
  ...partial,
})

describe('libraryOutline rules', () => {
  it('maps parents to the default child type for inline create', () => {
    expect(childTypeFor('science')).toBe('book')
    expect(childTypeFor('book')).toBe('chapter')
    expect(childTypeFor('course')).toBe('chapter')
    expect(childTypeFor('chapter')).toBe('chapter')
    expect(childTypeFor('notes')).toBeNull()
  })

  it('allows Tab-indent only when the structure is valid', () => {
    expect(canNestUnder('chapter', 'book')).toBe(true)
    expect(canNestUnder('chapter', 'chapter')).toBe(true)
    expect(canNestUnder('book', 'chapter')).toBe(false)
    expect(canNestUnder('science', 'book')).toBe(false)
  })

  it('treats whitespace-only titles as blank', () => {
    expect(isBlankTitle('')).toBe(true)
    expect(isBlankTitle('   ')).toBe(true)
    expect(isBlankTitle('Tawḥīd')).toBe(false)
  })

  it('finds the previous sibling for indent / Backspace focus', () => {
    const a = node({ id: 'a', type: 'chapter', order: 0, title: 'One' })
    const b = node({ id: 'b', type: 'chapter', order: 1, title: 'Two' })
    const c = node({ id: 'c', type: 'chapter', order: 2, title: 'Three' })
    expect(previousSibling(b, [a, b, c])?.id).toBe('a')
    expect(previousSibling(a, [a, b, c])).toBeNull()
  })
})
