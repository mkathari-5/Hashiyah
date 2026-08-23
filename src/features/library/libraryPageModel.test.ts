import { describe, expect, it } from 'vitest'
import type { LibraryBlock } from '@/types'
import {
  filterLibraryBlocks,
  indentPlacement,
  isPersistableBlock,
  LIBRARY_BLOCK_CATALOGUE,
  outdentPlacement,
  slashQueryFrom,
  splitContent,
  stripSlashQuery,
} from '@/features/library/libraryPageModel'

function block(partial: Partial<LibraryBlock> & Pick<LibraryBlock, 'id'>): LibraryBlock {
  return {
    pageId: 'p',
    parentBlockId: null,
    type: 'text',
    content: '',
    order: 0,
    expanded: false,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

describe('library page model', () => {
  it('defaults the catalogue to every supported block type', () => {
    expect(LIBRARY_BLOCK_CATALOGUE.map((entry) => entry.id)).toEqual([
      'text',
      'toggle',
      'heading1',
      'heading2',
      'heading3',
      'bullet',
      'numbered',
      'todo',
      'quote',
      'divider',
      'study',
    ])
  })

  it('filters slash queries, including heading 1 and toggle', () => {
    expect(filterLibraryBlocks('heading 1')[0]?.id).toBe('heading1')
    expect(filterLibraryBlocks('toggle')[0]?.id).toBe('toggle')
    expect(filterLibraryBlocks('quote').map((e) => e.id)).toContain('quote')
  })

  it('does not persist empty or in-progress slash text', () => {
    expect(isPersistableBlock(block({ id: 'a', content: '' }))).toBe(false)
    expect(isPersistableBlock(block({ id: 'a', content: '   ' }))).toBe(false)
    expect(isPersistableBlock(block({ id: 'a', content: '/heading 1' }))).toBe(false)
    expect(isPersistableBlock(block({ id: 'a', content: 'Introduction' }))).toBe(true)
    expect(isPersistableBlock(block({ id: 'a', type: 'toggle', content: '' }))).toBe(true)
    expect(isPersistableBlock(block({ id: 'a', type: 'divider', content: '' }))).toBe(true)
  })

  it('strips the slash query when converting', () => {
    expect(slashQueryFrom('/toggle')).toBe('toggle')
    expect(stripSlashQuery('/toggle')).toBe('')
    expect(stripSlashQuery('Hello\n/quote')).toBe('Hello')
  })

  it('splits on Enter at the caret', () => {
    expect(splitContent('ab', 1)).toEqual({ before: 'a', after: 'b' })
  })

  it('indents under the previous sibling and outdents after the parent', () => {
    const parent = block({ id: 'p1', type: 'toggle', content: 'Kitab' })
    const child = block({ id: 'c1', parentBlockId: null, order: 1, content: 'inside' })
    const all = [parent, child]
    expect(indentPlacement(child, all)).toEqual({ parentBlockId: 'p1', order: 0 })

    const nested = block({ id: 'c1', parentBlockId: 'p1', order: 0, content: 'inside' })
    expect(outdentPlacement(nested, [parent, nested])).toEqual({ parentBlockId: null, order: 1 })
  })

  it('refuses to indent when there is no previous sibling', () => {
    const only = block({ id: 'a', content: 'x' })
    expect(indentPlacement(only, [only])).toBeNull()
  })
})
