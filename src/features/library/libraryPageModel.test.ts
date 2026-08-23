import { describe, expect, it } from 'vitest'
import type { LibraryBlock } from '@/types'
import {
  filterLibraryBlocks,
  indentPlacement,
  isPersistableBlock,
  LIBRARY_BLOCK_CATALOGUE,
  makeTransientBlock,
  nextTransients,
  outdentPlacement,
  slashQueryFrom,
  splitContent,
  stripSlashQuery,
  transientIdFor,
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
      'page',
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

  it('gives an expanded empty toggle a nested draft without touching stored rows', () => {
    const toggle = block({ id: 't1', type: 'toggle', content: 'Book', expanded: true })
    const next = nextTransients('p', [toggle], {})
    expect(next[transientIdFor('t1')]?.parentBlockId).toBe('t1')
    expect(next[transientIdFor('t1')]?.type).toBe('text')
    expect(next[transientIdFor(null)]).toBeTruthy()
  })

  it('drops a nested draft when the toggle collapses', () => {
    const toggle = block({ id: 't1', type: 'toggle', content: 'Book', expanded: false })
    const nested = makeTransientBlock('p', 't1', 0)
    const next = nextTransients('p', [toggle], { [nested.id]: nested })
    expect(next[nested.id]).toBeUndefined()
  })

  it('does not resurrect an omitted nested draft after the first child is saved', () => {
    const toggle = block({ id: 't1', type: 'toggle', content: 'Book', expanded: true })
    const child = block({ id: 'c1', parentBlockId: 't1', content: 'Introduction' })
    const leftover = makeTransientBlock('p', 't1', 1)
    const next = nextTransients('p', [toggle, child], { [leftover.id]: leftover }, new Set([leftover.id]))
    expect(next[leftover.id]).toBeUndefined()
  })

  it('keeps the root draft after every stored root so it cannot sit between rows', () => {
    const first = block({ id: 'a', content: 'Alpha', order: 0 })
    const second = block({ id: 'b', content: 'Beta', order: 1 })
    const stale = makeTransientBlock('p', null, 0)
    const next = nextTransients('p', [first, second], { [stale.id]: stale })
    expect(next[transientIdFor(null)]?.order).toBe(2)
  })
})
