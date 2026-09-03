import { describe, expect, it } from 'vitest'
import type { LibraryBlock } from '@/types'
import {
  childrenOf,
  enterContinuationType,
  filterLibraryBlocks,
  indentPlacement,
  isPersistableBlock,
  LIBRARY_BLOCK_CATALOGUE,
  makeTransientBlock,
  nextTransients,
  spliceIndexAfter,
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
    expect(isPersistableBlock(block({ id: 'a', type: 'toggle', content: '' }))).toBe(false)
    expect(isPersistableBlock(block({ id: 'a', type: 'toggle', content: 'Aqidah' }))).toBe(true)
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

  it('gives an expanded empty toggle a nested draft without a trailing root draft', () => {
    const toggle = block({ id: 't1', type: 'toggle', content: 'Book', expanded: true })
    const next = nextTransients('p', [toggle], {})
    expect(next[transientIdFor('t1')]?.parentBlockId).toBe('t1')
    expect(next[transientIdFor('t1')]?.type).toBe('text')
    expect(next[transientIdFor(null)]).toBeUndefined()
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

  it('does not append a root draft when the page already has blocks', () => {
    const first = block({ id: 'a', content: 'Alpha', order: 0 })
    const second = block({ id: 'b', content: 'Beta', order: 1 })
    const next = nextTransients('p', [first, second], {})
    expect(next[transientIdFor(null)]).toBeUndefined()
  })

  it('keeps a user-created root draft in the position Enter assigned', () => {
    const first = block({ id: 'a', content: 'Alpha', order: 0 })
    const draft = makeTransientBlock('p', null, 0.5, 'toggle')
    const next = nextTransients('p', [first], { [draft.id]: draft }, new Set(), draft.id)
    expect(next[transientIdFor(null)]?.order).toBe(0.5)
    expect(next[transientIdFor(null)]?.type).toBe('toggle')
  })

  it('keeps a user-created empty root sibling until blur, even if it is not focused yet', () => {
    const first = block({ id: 'a', content: 'Alpha', order: 0 })
    const draft = makeTransientBlock('p', null, 1, 'toggle')
    const next = nextTransients('p', [first], { [draft.id]: draft }, new Set(), null)
    expect(next[transientIdFor(null)]?.type).toBe('toggle')
    expect(next[transientIdFor(null)]?.order).toBe(1)
  })

  it('drops an unfocused leftover root draft once stored blocks exist', () => {
    const first = block({ id: 'a', content: 'Alpha', order: 0 })
    const leftover = makeTransientBlock('p', null, 0, 'text', true)
    const next = nextTransients('p', [first], { [leftover.id]: leftover }, new Set(), null)
    expect(next[transientIdFor(null)]).toBeUndefined()
  })

  it('seeds one ephemeral line only on an empty page', () => {
    const next = nextTransients('p', [], {})
    expect(next[transientIdFor(null)]?.type).toBe('text')
    expect(next[transientIdFor(null)]?.content).toBe('')
  })

  it('continues lists as the same type and headings as text', () => {
    expect(enterContinuationType('toggle')).toBe('toggle')
    expect(enterContinuationType('bullet')).toBe('bullet')
    expect(enterContinuationType('numbered')).toBe('numbered')
    expect(enterContinuationType('todo')).toBe('todo')
    expect(enterContinuationType('quote')).toBe('quote')
    expect(enterContinuationType('text')).toBe('text')
    expect(enterContinuationType('heading1')).toBe('text')
    expect(enterContinuationType('heading2')).toBe('text')
  })

  it('orders a new sibling immediately after the current block', () => {
    const a = block({ id: 'a', content: 'Aqidah', type: 'toggle', order: 0 })
    const b = block({ id: 'b', content: 'Later', type: 'toggle', order: 1 })
    expect(spliceIndexAfter(a, [a, b])).toBe(1)
    expect(spliceIndexAfter(b, [a, b])).toBe(2)
  })

  it('places a transient at its splice index, even when stored orders collide', () => {
    const parent = block({ id: 'p1', type: 'toggle', content: 'fafawf', expanded: true })
    const kids = ['a', 'b', 'c', 'd', 'f', 'g', 'h'].map((content, index) =>
      block({ id: `k${index}`, parentBlockId: 'p1', type: 'toggle', content, order: 0 }),
    )
    const draft = makeTransientBlock('p', 'p1', 5, 'toggle')
    expect(childrenOf([parent, ...kids, draft], 'p1').map((row) => row.id)).toEqual([
      'k0',
      'k1',
      'k2',
      'k3',
      'k4',
      draft.id,
      'k5',
      'k6',
    ])
  })

  it('places a transient between dense siblings rather than after the next one', () => {
    const kids = [0, 1, 2, 3, 4, 5, 6].map((order) =>
      block({ id: `k${order}`, parentBlockId: 'p1', type: 'toggle', content: String(order), order }),
    )
    const draft = makeTransientBlock('p', 'p1', 5, 'toggle')
    expect(childrenOf([...kids, draft], 'p1').map((row) => row.id)).toEqual([
      'k0',
      'k1',
      'k2',
      'k3',
      'k4',
      draft.id,
      'k5',
      'k6',
    ])
  })
})
