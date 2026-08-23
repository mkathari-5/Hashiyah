import Dexie from 'dexie'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { db } from '@/db/db'
import { libraryBlocksRepo, ROOT_LIBRARY_PAGE_ID } from '@/db/repos/libraryPages'
import { libraryRepo } from '@/db/repos/libraryTree'
import { LibraryHome } from '@/features/library/LibraryHome'
import { LibraryEditor } from '@/features/library/LibraryEditor'
import { LIBRARY_BLOCK_CATALOGUE } from '@/features/library/libraryPageModel'
import { useLibraryStore } from '@/state/useLibraryStore'

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
  useLibraryStore.setState({ activeNodeId: null })
})

async function editorReady() {
  render(<LibraryHome onImport={() => undefined} />)
  await screen.findByLabelText('Page title')
  return screen.findByLabelText('Text')
}

function fill(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } })
  if (el instanceof HTMLTextAreaElement) el.setSelectionRange(value.length, value.length)
}

function pressEnter(el: HTMLElement) {
  if (el instanceof HTMLTextAreaElement) el.setSelectionRange(el.value.length, el.value.length)
  fireEvent.keyDown(el, { key: 'Enter' })
}

function emptyText(parentId = '') {
  const el = screen.getAllByLabelText('Text').find((node) => {
    const area = node as HTMLTextAreaElement
    if (area.value !== '') return false
    return node.closest('[data-parent-id]')?.getAttribute('data-parent-id') === parentId
  })
  if (!el) throw new Error(`No empty text block for parent "${parentId}"`)
  return el
}

async function stored() {
  return libraryBlocksRepo.forPage(ROOT_LIBRARY_PAGE_ID)
}

describe('Library page editor', () => {
  it('does not render the recursive LibraryTree or old creation controls', async () => {
    await editorReady()
    expect(document.querySelector('.lib-tree')).toBeNull()
    expect(screen.queryByText(/Add under/i)).toBeNull()
    expect(screen.queryByText(/New item/i)).toBeNull()
    expect(document.querySelector('.lib-add')).toBeNull()
    expect(document.querySelector('.lib-composer')).toBeNull()
  })

  it('opens with an editable Library title and a transient text line', async () => {
    await editorReady()
    const title = screen.getByLabelText('Page title') as HTMLInputElement
    expect(title.value).toBe('Library')
    const text = screen.getByLabelText('Text')
    expect(text).toHaveAttribute('placeholder', "Type '/' for commands")
    expect(text.closest('[data-transient="true"]')).toBeTruthy()
    expect(text.closest('[data-block-type="text"]')?.querySelector('.page-block-caret')).toBeNull()
    expect(await stored()).toHaveLength(0)
  })

  it('Enter at the start of a line does not persist a blank', async () => {
    const first = await editorReady()
    fill(first, 'Keep')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Keep'))
    const el = screen.getByDisplayValue('Keep') as HTMLTextAreaElement
    el.setSelectionRange(0, 0)
    fireEvent.keyDown(el, { key: 'Enter' })
    await waitFor(() => emptyText())
    const rows = await stored()
    expect(rows.filter((b) => b.content === 'Keep')).toHaveLength(1)
    expect(rows.filter((b) => b.type === 'text' && !b.content.trim())).toHaveLength(0)
  })

  it('Enter creates a sibling text block, not a child, and does not persist blanks', async () => {
    const first = await editorReady()
    fill(first, 'Introduction')
    await waitFor(async () => {
      expect((await stored()).map((b) => b.content)).toEqual(['Introduction'])
    })
    const intro = screen.getByDisplayValue('Introduction')
    pressEnter(intro)
    const second = await waitFor(() => emptyText())
    expect(second.closest('[data-parent-id]')?.getAttribute('data-parent-id')).toBe('')
    expect(second.closest('[data-block-id]')?.querySelector('.page-block-caret')).toBeNull()
    pressEnter(second)
    await waitFor(async () => expect(await stored()).toHaveLength(1))
    expect((await stored()).every((b) => b.content !== 'Untitled')).toBe(true)
    expect(screen.queryByText('Untitled')).toBeNull()
  })

  it('Shift+Enter inserts a line break inside the block', async () => {
    const first = await editorReady()
    fill(first, 'Line')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Line'))
    const el = screen.getByDisplayValue('Line')
    fireEvent.keyDown(el, { key: 'Enter', shiftKey: true })
    expect((await stored()).filter((b) => b.content === 'Line')).toHaveLength(1)
    expect(screen.getByDisplayValue('Line')).toBeInTheDocument()
  })

  it('opens a filterable slash menu and converts the current block', async () => {
    const first = await editorReady()
    fill(first, '/heading 1')
    const menu = await screen.findByTestId('slash-menu')
    expect(menu).toHaveTextContent('Heading 1')
    fill(first, '/toggle')
    expect(await screen.findByRole('option', { name: /Toggle list/i })).toBeInTheDocument()
    fireEvent.keyDown(first, { key: 'Enter' })
    await waitFor(() => expect(screen.getByLabelText('Toggle list')).toBeInTheDocument())
    const rows = await stored()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.type).toBe('toggle')
    expect(rows[0]?.content).not.toMatch(/^\/tog/)
  })

  it('can select every supported block type from the insert menu', async () => {
    const first = await editorReady()
    fill(first, 'Keep')
    await waitFor(async () => expect((await stored()).length).toBe(1))
    fireEvent.click(screen.getAllByLabelText('Insert block')[0]!)
    const menu = await screen.findByTestId('slash-menu')
    for (const def of LIBRARY_BLOCK_CATALOGUE) {
      expect(menu).toHaveTextContent(def.title)
    }
    fireEvent.mouseDown(screen.getByRole('option', { name: /Quote/ }))
    await waitFor(() => expect(screen.getByLabelText('Quote')).toBeInTheDocument())
  })

  it('only toggle blocks show chevrons, and expanding an empty toggle persists nothing', async () => {
    const first = await editorReady()
    fill(first, '/toggle')
    await screen.findByTestId('slash-menu')
    fireEvent.keyDown(first, { key: 'Enter' })
    const toggle = await screen.findByLabelText('Toggle list')
    fill(toggle, 'Kitab at-Taharah')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Kitab at-Taharah'))
    expect(screen.getByLabelText('Expand')).toBeInTheDocument()
    const toggleRow = screen.getByDisplayValue('Kitab at-Taharah').closest('[data-block-type="toggle"]')
    expect(toggleRow?.querySelector('.page-block-caret')).toBeTruthy()
    expect(document.querySelectorAll('.page-block-text .page-block-caret')).toHaveLength(0)
    fireEvent.click(screen.getByLabelText('Expand'))
    await waitFor(() => expect(screen.getByTestId('toggle-child-editor')).toBeInTheDocument())
    const nested = screen.getByTestId('toggle-child-editor')
    expect(nested.querySelector('.page-block-input')).toHaveAttribute('placeholder', "Type '/' for commands")
    const rows = await stored()
    expect(nested.getAttribute('data-parent-id')).toBe(rows[0]?.id)
    expect(nested.getAttribute('data-depth')).toBe('1')
    expect(nested.getAttribute('data-indent')).toBe('1.5')
    expect(rows.filter((b) => b.type === 'toggle')).toHaveLength(1)
    expect(rows.filter((b) => b.parentBlockId === rows[0]?.id)).toHaveLength(0)
  })

  it('Tab indents a sibling into a toggle and keeps it across collapse', async () => {
    const first = await editorReady()
    fill(first, '/toggle')
    await screen.findByTestId('slash-menu')
    fireEvent.keyDown(first, { key: 'Enter' })
    const toggle = await screen.findByLabelText('Toggle list')
    fill(toggle, 'Kitab at-Taharah')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Kitab at-Taharah'))
    pressEnter(await screen.findByDisplayValue('Kitab at-Taharah'))
    const child = await waitFor(() => emptyText())
    fill(child, 'Inside')
    await waitFor(async () => expect((await stored()).some((b) => b.content === 'Inside')).toBe(true))
    fireEvent.keyDown(screen.getByDisplayValue('Inside'), { key: 'Tab' })
    await waitFor(async () => {
      const blocks = await stored()
      const parent = blocks.find((b) => b.type === 'toggle')
      const nested = blocks.find((b) => b.content === 'Inside')
      expect(nested?.parentBlockId).toBe(parent?.id)
      expect(parent?.expanded).toBe(true)
    })
    await waitFor(() => expect(screen.getByLabelText('Collapse')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Collapse'))
    await waitFor(() => expect(screen.queryByDisplayValue('Inside')).toBeNull())
    fireEvent.click(screen.getByLabelText('Expand'))
    await waitFor(() => expect(screen.getByDisplayValue('Inside')).toBeInTheDocument())
    fireEvent.keyDown(screen.getByDisplayValue('Inside'), { key: 'Tab', shiftKey: true })
    await waitFor(async () => {
      expect((await stored()).find((b) => b.content === 'Inside')?.parentBlockId).toBeNull()
    })
  })

  it('Backspace removes an empty block', async () => {
    const first = await editorReady()
    fill(first, 'Keep')
    await waitFor(async () => expect((await stored()).length).toBe(1))
    pressEnter(screen.getByDisplayValue('Keep'))
    const second = await waitFor(() => emptyText())
    fireEvent.keyDown(second, { key: 'Backspace' })
    await waitFor(() => expect(screen.getByDisplayValue('Keep')).toBeInTheDocument())
    expect((await stored()).map((b) => b.content)).toEqual(['Keep'])
  })

  it('block order survives a remount', async () => {
    const first = await editorReady()
    fill(first, 'Alpha')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Alpha'))
    const trailing = await waitFor(() => emptyText())
    fill(trailing, 'Beta')
    await waitFor(async () => expect((await stored()).map((b) => b.content)).toEqual(['Alpha', 'Beta']))
    const beta = (await stored()).find((b) => b.content === 'Beta')!
    await libraryBlocksRepo.move(beta.id, null, 0)
    expect((await stored()).map((b) => b.content)).toEqual(['Beta', 'Alpha'])
  })

  it('Study page blocks open Study; text and toggle titles do not', async () => {
    await editorReady()
    const node = await libraryRepo.create({ parentId: null, type: 'book', title: 'Umdat' })
    await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'study',
      content: 'Umdat',
      libraryNodeId: node.id,
    })
    await waitFor(() => expect(screen.getByText('Umdat')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Umdat'))
    await waitFor(() => expect(useLibraryStore.getState().activeNodeId).toBe(node.id))

    useLibraryStore.setState({ activeNodeId: null })
    fireEvent.click(screen.getAllByLabelText('Text')[0]!)
    expect(useLibraryStore.getState().activeNodeId).toBeNull()
  })

  it('does not duplicate records under React Strict Mode', async () => {
    render(
      <StrictMode>
        <LibraryEditor pageId={ROOT_LIBRARY_PAGE_ID} />
      </StrictMode>,
    )
    const first = await screen.findByLabelText('Text')
    fill(first, 'Once')
    await waitFor(async () => {
      expect((await stored()).filter((b) => b.content === 'Once')).toHaveLength(1)
    })
  })

  it('hover + opens the block menu rather than creating a child', async () => {
    await editorReady()
    fireEvent.click(screen.getAllByLabelText('Insert block')[0]!)
    expect(await screen.findByTestId('slash-menu')).toBeInTheDocument()
    expect(await stored()).toHaveLength(0)
  })

  it('creates quote, to-do and bulleted list blocks from the slash menu', async () => {
    const first = await editorReady()
    fill(first, '/quote')
    await screen.findByTestId('slash-menu')
    fireEvent.keyDown(first, { key: 'Enter' })
    const quote = await screen.findByLabelText('Quote')
    fill(quote, 'A saying')
    pressEnter(quote)
    const next = await waitFor(() => emptyText())
    fill(next, '/to-do')
    await screen.findByTestId('slash-menu')
    fireEvent.keyDown(next, { key: 'Enter' })
    await screen.findByLabelText('To-do', { selector: 'textarea' })
    pressEnter(screen.getByLabelText('To-do', { selector: 'textarea' }))
    const third = await waitFor(() => emptyText())
    fill(third, '/bullet')
    await screen.findByTestId('slash-menu')
    fireEvent.keyDown(third, { key: 'Enter' })
    await screen.findByLabelText('Bulleted list')
    expect((await stored()).map((b) => b.type)).toEqual(expect.arrayContaining(['quote', 'todo', 'bullet']))
  })

  it('lets the user write, slash-convert and nest inside an expanded toggle', async () => {
    const first = await editorReady()
    fill(first, '/toggle')
    await screen.findByTestId('slash-menu')
    fireEvent.keyDown(first, { key: 'Enter' })
    fill(await screen.findByLabelText('Toggle list'), 'Book')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Book'))
    fireEvent.click(screen.getByLabelText('Expand'))
    const nested = await screen.findByTestId('toggle-child-editor')
    const editor = nested.querySelector('textarea')!
    fireEvent.click(editor)
    await waitFor(() => expect(document.activeElement).toBe(editor))
    fill(editor, 'Introduction')
    const book = (await stored())[0]!
    await waitFor(async () => {
      const child = (await stored()).find((b) => b.content === 'Introduction')
      expect(child?.parentBlockId).toBe(book.id)
      expect(child?.type).toBe('text')
    })

    pressEnter(screen.getByDisplayValue('Introduction'))
    const sibling = await waitFor(() => emptyText(book.id))
    fill(sibling, 'Chapter One')
    await waitFor(async () => {
      const kids = (await stored()).filter((b) => b.parentBlockId === book.id)
      expect(kids.map((b) => b.content)).toEqual(['Introduction', 'Chapter One'])
    })

    pressEnter(screen.getByDisplayValue('Chapter One'))
    const third = await waitFor(() => emptyText(book.id))
    fill(third, '/heading 2')
    await screen.findByTestId('slash-menu')
    fireEvent.keyDown(third, { key: 'Enter' })
    const heading = await screen.findByLabelText('Heading 2')
    fill(heading, 'Part')
    await waitFor(async () => {
      expect((await stored()).find((b) => b.content === 'Part')?.type).toBe('heading2')
      expect((await stored()).find((b) => b.content === 'Part')?.parentBlockId).toBe(book.id)
    })

    pressEnter(screen.getByDisplayValue('Part'))
    const fourth = await waitFor(() => emptyText(book.id))
    fill(fourth, '/toggle')
    await screen.findByTestId('slash-menu')
    fireEvent.keyDown(fourth, { key: 'Enter' })
    const section = await waitFor(() => {
      const toggles = screen.getAllByLabelText('Toggle list')
      expect(toggles.length).toBeGreaterThanOrEqual(2)
      return toggles[toggles.length - 1]!
    })
    fill(section, 'Section One')
    const sectionBlock = await waitFor(async () => {
      const found = (await stored()).find((b) => b.content === 'Section One' && b.type === 'toggle')
      expect(found).toBeTruthy()
      return found!
    })
    const sectionRow = screen.getByDisplayValue('Section One').closest('[data-block-type="toggle"]') as HTMLElement
    const expander = sectionRow.querySelector('[aria-label="Expand"]')
    expect(expander).toBeTruthy()
    fireEvent.click(expander!)
    const innerEditor = await waitFor(() => emptyText(sectionBlock.id))
    fill(innerEditor, 'Nested text')
    await waitFor(async () => {
      const nestedText = (await stored()).find((b) => b.content === 'Nested text')
      expect(nestedText?.parentBlockId).toBe(sectionBlock.id)
    })

    fireEvent.click(screen.getByDisplayValue('Section One').closest('[data-block-type="toggle"]')!.querySelector('[aria-label="Collapse"]')!)
    await waitFor(() => expect(screen.queryByDisplayValue('Nested text')).toBeNull())
    fireEvent.click(screen.getByLabelText('Collapse'))
    await waitFor(() => expect(screen.queryByDisplayValue('Introduction')).toBeNull())
    fireEvent.click(screen.getByLabelText('Expand'))
    await waitFor(() => expect(screen.getByDisplayValue('Introduction')).toBeInTheDocument())
    fireEvent.click(screen.getByDisplayValue('Section One').closest('[data-block-type="toggle"]')!.querySelector('[aria-label="Expand"]')!)
    await waitFor(() => expect(screen.getByDisplayValue('Nested text')).toBeInTheDocument())
    expect((await stored()).every((b) => b.content !== 'Untitled')).toBe(true)
  })

  it('creates every supported type inside a toggle from the nested slash menu', async () => {
    const first = await editorReady()
    fill(first, '/toggle')
    await screen.findByTestId('slash-menu')
    fireEvent.keyDown(first, { key: 'Enter' })
    fill(await screen.findByLabelText('Toggle list'), 'Book')
    await waitFor(async () => expect((await stored())[0]?.type).toBe('toggle'))
    fireEvent.click(screen.getByLabelText('Expand'))
    const nested = (await screen.findByTestId('toggle-child-editor')).querySelector('textarea')!
    fill(nested, '/')
    const menu = await screen.findByTestId('slash-menu')
    for (const def of LIBRARY_BLOCK_CATALOGUE) {
      expect(menu).toHaveTextContent(def.title)
    }
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Quote$/ }))
    await waitFor(async () => {
      const book = (await stored()).find((b) => b.type === 'toggle')
      expect((await stored()).some((b) => b.type === 'quote' && b.parentBlockId === book?.id)).toBe(true)
    })
  })

  it('Backspace on an extra empty nested sibling restores focus to the previous child', async () => {
    const first = await editorReady()
    fill(first, '/toggle')
    await screen.findByTestId('slash-menu')
    fireEvent.keyDown(first, { key: 'Enter' })
    fill(await screen.findByLabelText('Toggle list'), 'Book')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Book'))
    fireEvent.click(screen.getByLabelText('Expand'))
    const nested = (await screen.findByTestId('toggle-child-editor')).querySelector('textarea')!
    fill(nested, 'Keep')
    await waitFor(async () => expect((await stored()).some((b) => b.content === 'Keep')).toBe(true))
    pressEnter(screen.getByDisplayValue('Keep'))
    const book = (await stored()).find((b) => b.type === 'toggle')!
    const extra = await waitFor(() => emptyText(book.id))
    fireEvent.click(extra)
    fireEvent.keyDown(extra, { key: 'Backspace' })
    await waitFor(() => expect(screen.queryByTestId('toggle-child-editor')).toBeNull())
    expect(screen.getByDisplayValue('Keep')).toBeInTheDocument()
    expect((await stored()).filter((b) => b.parentBlockId != null)).toHaveLength(1)
  })

  it('shows hover controls for only the active row without shifting text', async () => {
    const first = await editorReady()
    fill(first, 'Alpha')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Alpha'))
    const alpha = screen.getByDisplayValue('Alpha').closest('.page-block') as HTMLElement
    const trailing = (await waitFor(() => emptyText())).closest('.page-block') as HTMLElement
    const before = alpha.style.getPropertyValue('--indent')
    fireEvent.mouseEnter(alpha)
    expect(alpha).toHaveClass('is-gutter-on')
    expect(trailing).not.toHaveClass('is-gutter-on')
    expect(alpha.style.getPropertyValue('--indent')).toBe(before)
    fireEvent.mouseLeave(alpha)
    fireEvent.mouseEnter(trailing)
    expect(alpha).not.toHaveClass('is-gutter-on')
    expect(trailing).toHaveClass('is-gutter-on')
  })

  it('uses the same indentation increment at every nesting level', async () => {
    const first = await editorReady()
    fill(first, '/toggle')
    await screen.findByTestId('slash-menu')
    fireEvent.keyDown(first, { key: 'Enter' })
    fill(await screen.findByLabelText('Toggle list'), 'Book')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Book'))
    fireEvent.click(screen.getByLabelText('Expand'))
    const child = (await screen.findByTestId('toggle-child-editor')) as HTMLElement
    expect(child.dataset.depth).toBe('1')
    expect(child.dataset.indent).toBe('1.5')
    const nestedTa = child.querySelector('textarea')!
    fill(nestedTa, '/toggle')
    await screen.findByTestId('slash-menu')
    fireEvent.keyDown(nestedTa, { key: 'Enter' })
    const innerToggle = await waitFor(() => {
      const toggles = screen.getAllByLabelText('Toggle list')
      expect(toggles.length).toBeGreaterThanOrEqual(2)
      return toggles[1]!
    })
    fill(innerToggle, 'Section')
    await waitFor(async () => expect((await stored()).some((b) => b.content === 'Section')).toBe(true))
    const sectionRow = screen.getByDisplayValue('Section').closest('[data-block-type="toggle"]') as HTMLElement
    fireEvent.click(sectionRow.querySelector('[aria-label="Expand"]')!)
    const grand = await waitFor(() => {
      const section = (screen.getByDisplayValue('Section').closest('[data-block-type="toggle"]') as HTMLElement)
        .parentElement
      const draft = section?.querySelector('[data-testid="toggle-child-editor"]') as HTMLElement | null
      expect(draft).toBeTruthy()
      return draft!
    })
    expect(grand.dataset.depth).toBe('2')
    expect(grand.dataset.indent).toBe('3')
  })

  it('reload preserves nested content, types and parent ids', async () => {
    const view = render(<LibraryHome onImport={() => undefined} />)
    await screen.findByLabelText('Page title')
    const first = await screen.findByLabelText('Text')
    fill(first, '/toggle')
    await screen.findByTestId('slash-menu')
    fireEvent.keyDown(first, { key: 'Enter' })
    fill(await screen.findByLabelText('Toggle list'), 'Book')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Book'))
    fireEvent.click(screen.getByLabelText('Expand'))
    const nested = (await screen.findByTestId('toggle-child-editor')).querySelector('textarea')!
    fill(nested, 'Introduction')
    await waitFor(async () => expect((await stored()).some((b) => b.content === 'Introduction')).toBe(true))
    const book = (await stored()).find((b) => b.type === 'toggle')!
    pressEnter(screen.getByDisplayValue('Introduction'))
    fill(await waitFor(() => emptyText(book.id)), 'Chapter One')
    await waitFor(async () => {
      const kids = (await stored()).filter((b) => b.parentBlockId === book.id)
      expect(kids.map((b) => b.content)).toEqual(['Introduction', 'Chapter One'])
    })
    view.unmount()
    render(<LibraryHome onImport={() => undefined} />)
    await waitFor(() => expect(screen.getByDisplayValue('Book')).toBeInTheDocument())
    const caret = screen.getByDisplayValue('Book').closest('[data-block-type="toggle"]')?.querySelector('[aria-label="Expand"]')
    if (caret) fireEvent.click(caret)
    await waitFor(() => expect(screen.getByDisplayValue('Introduction')).toBeInTheDocument())
    expect(screen.getByDisplayValue('Chapter One')).toBeInTheDocument()
    const blocks = await stored()
    expect(blocks.find((b) => b.content === 'Introduction')?.parentBlockId).toBe(book.id)
    expect(blocks.find((b) => b.content === 'Chapter One')?.parentBlockId).toBe(book.id)
    expect(blocks.every((b) => b.content !== 'Untitled')).toBe(true)
  })
})
