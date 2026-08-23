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

function emptyText() {
  const el = screen.getAllByLabelText('Text').find((node) => (node as HTMLTextAreaElement).value === '')
  if (!el) throw new Error('No empty text block')
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
    await waitFor(() => expect(screen.getByLabelText('Collapse')).toBeInTheDocument())
    const rows = await stored()
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
})
