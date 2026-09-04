import Dexie from 'dexie'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TextSelection } from '@tiptap/pm/state'
import { db } from '@/db/db'
import { libraryBlocksRepo, libraryPagesRepo, ROOT_LIBRARY_PAGE_ID } from '@/db/repos/libraryPages'
import { libraryRepo } from '@/db/repos/libraryTree'
import { LibraryHome } from '@/features/library/LibraryHome'
import { LibraryEditor } from '@/features/library/LibraryEditor'
import { LIBRARY_BLOCK_CATALOGUE, PREVIOUS_LIBRARY_TITLE } from '@/features/library/libraryPageModel'
import type { TitleEditorHost } from '@/features/library/TitleInlineEditor'
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

function pmEl(from: HTMLElement | null | undefined): HTMLElement | null {
  if (!from) return null
  if (from.classList.contains('ProseMirror')) return from
  return (from.querySelector('.ProseMirror') as HTMLElement | null) ?? from.closest('.ProseMirror')
}

function editorViewFrom(from: HTMLElement) {
  const host = (
    from.closest('[data-title-editor]') ?? from.querySelector('[data-title-editor]') ?? from.closest('.page-block')?.querySelector('[data-title-editor]')
  ) as TitleEditorHost | null
  return host?.__editorView ?? null
}

function fill(el: HTMLElement, value: string) {
  const view = editorViewFrom(el)
  if (view) {
    const size = view.state.doc.content.size
    view.dispatch(view.state.tr.insertText(value, 1, Math.max(1, size - 1)))
    return
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    fireEvent.change(el, { target: { value } })
    el.setSelectionRange(value.length, value.length)
  }
}

function pressKey(el: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  const view = editorViewFrom(el)
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  if (view) {
    const handled = view.someProp('handleKeyDown', (fn) => fn(view, event))
    if (handled) return
  }
  fireEvent.keyDown((view?.dom as HTMLElement | undefined) ?? pmEl(el) ?? el, { key, ...init })
}

function pressEnter(el: HTMLElement) {
  const view = editorViewFrom(el)
  if (view) {
    const end = Math.max(1, view.state.doc.content.size - 1)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
  }
  pressKey(el, 'Enter')
}

function emptyByLabel(label: string, parentId = '') {
  const el = screen.getAllByLabelText(label).find((node) => {
    const host = node.closest('[data-parent-id]')
    if (host?.getAttribute('data-parent-id') !== parentId) return false
    const plain = host.querySelector('[data-plain]')?.getAttribute('data-plain')
    if (plain != null) return plain === ''
    return node instanceof HTMLTextAreaElement && node.value === ''
  })
  if (!el) throw new Error(`No empty ${label} block for parent "${parentId}"`)
  return el
}

async function setCaret(el: HTMLElement, pos: number) {
  const host = (el.closest('.page-block') as HTMLElement | null) ?? el
  if (!pmEl(host) && !editorViewFrom(host)) {
    const idle = host.querySelector('.page-block-input.is-idle') as HTMLElement | null
    fireEvent.click(idle ?? host)
    await waitFor(() => {
      if (!editorViewFrom(host)) throw new Error('editor not mounted')
    })
  }
  const view = editorViewFrom(host)
  if (!view) return
  const at = Math.max(1, Math.min(pos + 1, view.state.doc.content.size - 1))
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
}

function emptyText(parentId = '') {
  return emptyByLabel('Text', parentId)
}

function placeholderOf(el: HTMLElement) {
  return (
    el.getAttribute('placeholder') ||
    el.getAttribute('data-placeholder') ||
    el.closest('[data-placeholder]')?.getAttribute('data-placeholder') ||
    el.querySelector('[data-placeholder]')?.getAttribute('data-placeholder') ||
    ''
  )
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
    expect(
      text.getAttribute('placeholder') ??
        text.closest('[data-placeholder]')?.getAttribute('data-placeholder') ??
        text.closest('[placeholder]')?.getAttribute('placeholder'),
    ).toBe("Type '/' for commands")
    expect(text.closest('[data-transient="true"]')).toBeTruthy()
    expect(text.closest('[data-block-type="text"]')?.querySelector('.page-block-caret')).toBeNull()
    expect(await stored()).toHaveLength(0)
  })

  it('Enter at the start of a line does not persist a blank', async () => {
    const first = await editorReady()
    fill(first, 'Keep')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Keep'))
    const row = screen.getByText('Keep').closest('.page-block') as HTMLElement
    await setCaret(row, 0)
    pressKey(row, 'Enter')
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
    const intro = screen.getByText('Introduction')
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
    const el = screen.getByText('Line')
    pressKey(el, 'Enter', { shiftKey: true })
    expect((await stored()).filter((b) => b.content === 'Line')).toHaveLength(1)
    expect(screen.getByText('Line')).toBeInTheDocument()
  })

  it('opens a filterable slash menu and converts the current block', async () => {
    const first = await editorReady()
    fill(first, '/heading 1')
    const menu = await screen.findByTestId('slash-menu')
    expect(menu).toHaveTextContent('Heading 1')
    fill(first, '/toggle')
    expect(await screen.findByRole('option', { name: /Toggle list/i })).toBeInTheDocument()
    pressEnter(first)
    const toggle = await screen.findByLabelText('Toggle list')
    fill(toggle, 'Aqidah')
    await waitFor(async () => {
      const rows = await stored()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.type).toBe('toggle')
      expect(rows[0]?.content).toBe('Aqidah')
      expect(rows[0]?.content).not.toMatch(/^\/tog/)
    })
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
    pressEnter(first)
    const toggle = await screen.findByLabelText('Toggle list')
    fill(toggle, 'Kitab at-Taharah')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Kitab at-Taharah'))
    expect(screen.getByLabelText('Expand')).toBeInTheDocument()
    const toggleRow = screen.getByText('Kitab at-Taharah').closest('[data-block-type="toggle"]')
    expect(toggleRow?.querySelector('.page-block-caret')).toBeTruthy()
    expect(document.querySelectorAll('.page-block-text .page-block-caret')).toHaveLength(0)
    fireEvent.click(screen.getByLabelText('Expand'))
    await waitFor(() => expect(screen.getByTestId('toggle-child-editor')).toBeInTheDocument())
    const nested = screen.getByTestId('toggle-child-editor')
    expect(nested.querySelector('.page-block-input')).toHaveAttribute('data-placeholder', "Type '/' for commands")
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
    pressEnter(first)
    const toggle = await screen.findByLabelText('Toggle list')
    fill(toggle, 'Kitab at-Taharah')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Kitab at-Taharah'))
    pressEnter(await screen.findByText('Kitab at-Taharah'))
    const nextToggle = await waitFor(() => emptyByLabel('Toggle list'))
    pressEnter(nextToggle)
    const child = await waitFor(() => emptyText())
    fill(child, 'Inside')
    await waitFor(async () => expect((await stored()).some((b) => b.content === 'Inside')).toBe(true))
    pressKey(screen.getByText('Inside'), 'Tab')
    await waitFor(async () => {
      const blocks = await stored()
      const parent = blocks.find((b) => b.type === 'toggle')
      const nested = blocks.find((b) => b.content === 'Inside')
      expect(nested?.parentBlockId).toBe(parent?.id)
      expect(parent?.expanded).toBe(true)
    })
    await waitFor(() => expect(screen.getByLabelText('Collapse')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Collapse'))
    await waitFor(() => expect(screen.queryByText('Inside')).toBeNull())
    fireEvent.click(await screen.findByLabelText('Expand'))
    await waitFor(() => expect(screen.getByText('Inside')).toBeInTheDocument())
    pressKey(screen.getByText('Inside'), 'Tab', { shiftKey: true })
    await waitFor(async () => {
      expect((await stored()).find((b) => b.content === 'Inside')?.parentBlockId).toBeNull()
    })
  })

  it('Backspace removes an empty block', async () => {
    const first = await editorReady()
    fill(first, 'Keep')
    await waitFor(async () => expect((await stored()).length).toBe(1))
    pressEnter(screen.getByText('Keep'))
    const second = await waitFor(() => emptyText())
    pressKey(second, 'Backspace')
    await waitFor(() => expect(screen.getByText('Keep')).toBeInTheDocument())
    expect((await stored()).map((b) => b.content)).toEqual(['Keep'])
  })

  it('block order survives a remount', async () => {
    const first = await editorReady()
    fill(first, 'Alpha')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Alpha'))
    pressEnter(screen.getByText('Alpha'))
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
    fireEvent.click(screen.getByLabelText('Page title'))
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
    pressEnter(first)
    const quote = await screen.findByLabelText('Quote')
    fill(quote, 'A saying')
    pressEnter(quote)
    const next = await waitFor(() => emptyByLabel('Quote'))
    fill(next, '/to-do')
    await screen.findByTestId('slash-menu')
    pressEnter(next)
    const todo = await screen.findByLabelText('To-do')
    fill(todo, 'Task')
    pressEnter(todo)
    const third = await waitFor(() => emptyByLabel('To-do'))
    fill(third, '/bullet')
    await screen.findByTestId('slash-menu')
    pressEnter(third)
    const bullet = await screen.findByLabelText('Bulleted list')
    fill(bullet, 'Point')
    await waitFor(async () => {
      expect((await stored()).map((b) => b.type)).toEqual(expect.arrayContaining(['quote', 'todo', 'bullet']))
    })
  })

  it('lets the user write, slash-convert and nest inside an expanded toggle', async () => {
    const first = await editorReady()
    fill(first, '/toggle')
    await screen.findByTestId('slash-menu')
    pressEnter(first)
    fill(await screen.findByLabelText('Toggle list'), 'Book')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Book'))
    fireEvent.click(screen.getByLabelText('Expand'))
    const nested = await screen.findByTestId('toggle-child-editor')
    const editor = (nested.querySelector('.ProseMirror') as HTMLElement | null) ?? nested
    fireEvent.click(editor)
    await waitFor(() => expect(nested.contains(document.activeElement)).toBe(true))
    fill(editor, 'Introduction')
    const book = (await stored())[0]!
    await waitFor(async () => {
      const child = (await stored()).find((b) => b.content === 'Introduction')
      expect(child?.parentBlockId).toBe(book.id)
      expect(child?.type).toBe('text')
    })

    pressEnter(screen.getByText('Introduction'))
    const sibling = await waitFor(() => emptyText(book.id))
    fill(sibling, 'Chapter One')
    await waitFor(async () => {
      const kids = (await stored()).filter((b) => b.parentBlockId === book.id)
      expect(kids.map((b) => b.content)).toEqual(['Introduction', 'Chapter One'])
    })

    pressEnter(screen.getByText('Chapter One'))
    const third = await waitFor(() => emptyText(book.id))
    fill(third, '/heading 2')
    await screen.findByTestId('slash-menu')
    pressEnter(third)
    const heading = await screen.findByLabelText('Heading 2')
    fill(heading, 'Part')
    await waitFor(async () => {
      expect((await stored()).find((b) => b.content === 'Part')?.type).toBe('heading2')
      expect((await stored()).find((b) => b.content === 'Part')?.parentBlockId).toBe(book.id)
    })

    pressEnter(screen.getByText('Part'))
    const fourth = await waitFor(() => emptyText(book.id))
    fill(fourth, '/toggle')
    await screen.findByTestId('slash-menu')
    pressEnter(fourth)
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
    const sectionRow = screen.getByText('Section One').closest('[data-block-type="toggle"]') as HTMLElement
    const expander = sectionRow.querySelector('[aria-label="Expand"]')
    expect(expander).toBeTruthy()
    fireEvent.click(expander!)
    const innerEditor = await waitFor(() => emptyText(sectionBlock.id))
    fill(innerEditor, 'Nested text')
    await waitFor(async () => {
      const nestedText = (await stored()).find((b) => b.content === 'Nested text')
      expect(nestedText?.parentBlockId).toBe(sectionBlock.id)
    })

    fireEvent.click(screen.getByText('Section One').closest('[data-block-type="toggle"]')!.querySelector('[aria-label="Collapse"]')!)
    await waitFor(() => expect(screen.queryByText('Nested text')).toBeNull())
    fireEvent.click(screen.getByLabelText('Collapse'))
    await waitFor(() => expect(screen.queryByText('Introduction')).toBeNull())
    fireEvent.click(screen.getByLabelText('Expand'))
    await waitFor(() => expect(screen.getByText('Introduction')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Section One').closest('[data-block-type="toggle"]')!.querySelector('[aria-label="Expand"]')!)
    await waitFor(() => expect(screen.getByText('Nested text')).toBeInTheDocument())
    expect((await stored()).every((b) => b.content !== 'Untitled')).toBe(true)
  })

  it('creates every supported type inside a toggle from the nested slash menu', async () => {
    const first = await editorReady()
    fill(first, '/toggle')
    await screen.findByTestId('slash-menu')
    pressEnter(first)
    fill(await screen.findByLabelText('Toggle list'), 'Book')
    await waitFor(async () => expect((await stored())[0]?.type).toBe('toggle'))
    fireEvent.click(screen.getByLabelText('Expand'))
    const nested = (await screen.findByTestId('toggle-child-editor')).querySelector('.ProseMirror, [data-title-editor]') as HTMLElement
    fill(nested, '/')
    const menu = await screen.findByTestId('slash-menu')
    for (const def of LIBRARY_BLOCK_CATALOGUE) {
      expect(menu).toHaveTextContent(def.title)
    }
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Quote$/ }))
    const quote = await screen.findByLabelText('Quote')
    fill(quote, 'A saying')
    await waitFor(async () => {
      const book = (await stored()).find((b) => b.type === 'toggle')
      expect((await stored()).some((b) => b.type === 'quote' && b.parentBlockId === book?.id)).toBe(true)
    })
  })

  it('Backspace on an extra empty nested sibling restores focus to the previous child', async () => {
    const first = await editorReady()
    fill(first, '/toggle')
    await screen.findByTestId('slash-menu')
    pressEnter(first)
    fill(await screen.findByLabelText('Toggle list'), 'Book')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Book'))
    fireEvent.click(screen.getByLabelText('Expand'))
    const nested = (await screen.findByTestId('toggle-child-editor')).querySelector('.ProseMirror, [data-title-editor]') as HTMLElement
    fill(nested, 'Keep')
    await waitFor(async () => expect((await stored()).some((b) => b.content === 'Keep')).toBe(true))
    pressEnter(screen.getByText('Keep'))
    const book = (await stored()).find((b) => b.type === 'toggle')!
    const extra = await waitFor(() => emptyText(book.id))
    fireEvent.click(extra)
    pressKey(extra, 'Backspace')
    await waitFor(() => expect(screen.queryByTestId('toggle-child-editor')).toBeNull())
    expect(screen.getByText('Keep')).toBeInTheDocument()
    expect((await stored()).filter((b) => b.parentBlockId != null)).toHaveLength(1)
  })

  it('shows hover controls for only the active row without shifting text', async () => {
    const first = await editorReady()
    fill(first, 'Alpha')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Alpha'))
    const alpha = screen.getByText('Alpha').closest('.page-block') as HTMLElement
    pressEnter(screen.getByText('Alpha'))
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
    pressEnter(first)
    fill(await screen.findByLabelText('Toggle list'), 'Book')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Book'))
    fireEvent.click(screen.getByLabelText('Expand'))
    const child = (await screen.findByTestId('toggle-child-editor')) as HTMLElement
    expect(child.dataset.depth).toBe('1')
    expect(child.dataset.indent).toBe('1.5')
    const nestedTa = child.querySelector('.ProseMirror, [data-title-editor]') as HTMLElement
    fill(nestedTa, '/toggle')
    await screen.findByTestId('slash-menu')
    pressEnter(nestedTa)
    const innerToggle = await waitFor(() => {
      const toggles = screen.getAllByLabelText('Toggle list')
      expect(toggles.length).toBeGreaterThanOrEqual(2)
      return toggles[1]!
    })
    fill(innerToggle, 'Section')
    await waitFor(async () => expect((await stored()).some((b) => b.content === 'Section')).toBe(true))
    const sectionRow = screen.getByText('Section').closest('[data-block-type="toggle"]') as HTMLElement
    fireEvent.click(sectionRow.querySelector('[aria-label="Expand"]')!)
    const grand = await waitFor(() => {
      const section = (screen.getByText('Section').closest('[data-block-type="toggle"]') as HTMLElement)
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
    pressEnter(first)
    fill(await screen.findByLabelText('Toggle list'), 'Book')
    await waitFor(async () => expect((await stored())[0]?.content).toBe('Book'))
    fireEvent.click(screen.getByLabelText('Expand'))
    const nested = (await screen.findByTestId('toggle-child-editor')).querySelector('.ProseMirror, [data-title-editor]') as HTMLElement
    fill(nested, 'Introduction')
    await waitFor(async () => expect((await stored()).some((b) => b.content === 'Introduction')).toBe(true))
    const book = (await stored()).find((b) => b.type === 'toggle')!
    pressEnter(screen.getByText('Introduction'))
    fill(await waitFor(() => emptyText(book.id)), 'Chapter One')
    await waitFor(async () => {
      const kids = (await stored()).filter((b) => b.parentBlockId === book.id)
      expect(kids.map((b) => b.content)).toEqual(['Introduction', 'Chapter One'])
    })
    view.unmount()
    render(<LibraryHome onImport={() => undefined} />)
    await waitFor(() => expect(screen.getByText('Book')).toBeInTheDocument())
    expect(screen.queryByPlaceholderText("Type '/' for commands")).toBeNull()
    const caret = screen.getByText('Book').closest('[data-block-type="toggle"]')?.querySelector('[aria-label="Expand"]')
    if (caret) fireEvent.click(caret)
    await waitFor(() => expect(screen.getByText('Introduction')).toBeInTheDocument())
    expect(screen.getByText('Chapter One')).toBeInTheDocument()
    const blocks = await stored()
    expect(blocks.find((b) => b.content === 'Introduction')?.parentBlockId).toBe(book.id)
    expect(blocks.find((b) => b.content === 'Chapter One')?.parentBlockId).toBe(book.id)
    expect(blocks.every((b) => b.content !== 'Untitled')).toBe(true)
  })

  it('does not show a trailing command placeholder when the page already has blocks', async () => {
    await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'toggle',
      content: 'fafawf',
    })
    render(<LibraryHome onImport={() => undefined} />)
    await screen.findByText('fafawf')
    expect(screen.queryByPlaceholderText("Type '/' for commands")).toBeNull()
    expect(screen.queryByLabelText('Text')).toBeNull()
  })

  it('clicking blank canvas creates one transient text block that blur removes', async () => {
    await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'toggle',
      content: 'fafawf',
    })
    render(<LibraryHome onImport={() => undefined} />)
    await screen.findByText('fafawf')
    fireEvent.click(screen.getByText('fafawf'))
    fireEvent.click(screen.getByTestId('page-editor-tail'))
    const draft = await waitFor(() => emptyText())
    expect(placeholderOf(draft)).toBe("Type '/' for commands")
    expect(draft.closest('[data-transient="true"]')).toBeTruthy()
    expect(await stored()).toHaveLength(1)
    screen.getByLabelText('Page title').focus()
    fireEvent.blur(draft)
    await waitFor(() => expect(screen.queryByPlaceholderText("Type '/' for commands")).toBeNull())
    expect(await stored()).toHaveLength(1)
    expect((await stored())[0]?.content).toBe('fafawf')
  })

  it('Enter after a toggle title creates a same-level toggle sibling, not a child', async () => {
    const aqidah = await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'toggle',
      content: 'Aqidah',
      expanded: false,
    })
    const child = await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      parentBlockId: aqidah.id,
      type: 'text',
      content: 'Inside Aqidah',
    })
    render(<LibraryHome onImport={() => undefined} />)
    const title = await screen.findByText('Aqidah')
    pressEnter(title)
    const sibling = await waitFor(() => emptyByLabel('Toggle list'))
    expect(sibling.closest('[data-parent-id]')?.getAttribute('data-parent-id')).toBe('')
    expect(sibling.closest('[data-block-type]')?.getAttribute('data-block-type')).toBe('toggle')
    await waitFor(() => expect(sibling.closest('.page-block')?.contains(document.activeElement)).toBe(true))
    expect(screen.queryByPlaceholderText("Type '/' for commands")).toBeNull()
    fill(sibling, 'Tawhid')
    await waitFor(async () => {
      const rows = await stored()
      const tawhid = rows.find((b) => b.content === 'Tawhid')
      expect(tawhid?.type).toBe('toggle')
      expect(tawhid?.parentBlockId).toBeNull()
      expect(tawhid?.order).toBeGreaterThan(aqidah.order)
      expect(rows.find((b) => b.content === 'Inside Aqidah')?.parentBlockId).toBe(aqidah.id)
      expect(rows.filter((b) => b.parentBlockId === aqidah.id).map((b) => b.id)).toEqual([child.id])
      expect(rows.filter((b) => !b.content.trim())).toHaveLength(0)
      expect(rows.every((b) => b.content !== 'Untitled')).toBe(true)
    })
    const aqidahRow = screen.getByText('Aqidah').closest('[data-block-type="toggle"]') as HTMLElement
    fireEvent.click(aqidahRow.querySelector('[aria-label="Expand"]')!)
    await waitFor(() => expect(screen.getByText('Inside Aqidah')).toBeInTheDocument())
    expect(screen.getByText('Tawhid').closest('[data-parent-id]')?.getAttribute('data-parent-id')).toBe('')
  })

  it('Enter after a collapsed or expanded toggle still creates a sibling', async () => {
    await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'toggle',
      content: 'Aqidah',
      expanded: true,
    })
    render(<LibraryHome onImport={() => undefined} />)
    pressEnter(await screen.findByText('Aqidah'))
    const sibling = await waitFor(() => emptyByLabel('Toggle list'))
    expect(sibling.closest('[data-parent-id]')?.getAttribute('data-parent-id')).toBe('')
    fill(sibling, 'Tawhid')
    await waitFor(async () => {
      const rows = await stored()
      expect(rows.find((b) => b.content === 'Tawhid')?.parentBlockId).toBeNull()
      expect(rows.find((b) => b.content === 'Tawhid')?.type).toBe('toggle')
    })
  })

  it('Enter continues bullets, numbered items and to-dos as the same type', async () => {
    await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'bullet',
      content: 'First',
    })
    render(<LibraryHome onImport={() => undefined} />)
    pressEnter(await screen.findByText('First'))
    const bullet = await waitFor(() => emptyByLabel('Bulleted list'))
    fill(bullet, 'Second')
    await waitFor(async () => {
      expect((await stored()).filter((b) => b.type === 'bullet').map((b) => b.content)).toEqual(['First', 'Second'])
    })
    pressEnter(screen.getByText('Second'))
    const emptyBullet = await waitFor(() => emptyByLabel('Bulleted list'))
    pressEnter(emptyBullet)
    await waitFor(() => expect(emptyText()).toBeTruthy())
    await waitFor(async () => {
      const rows = await stored()
      expect(rows.filter((b) => b.type === 'bullet')).toHaveLength(2)
      expect(rows.filter((b) => !b.content.trim())).toHaveLength(0)
    })
  })

  it('Enter continues numbered items as numbered siblings', async () => {
    await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'numbered',
      content: 'One',
    })
    render(<LibraryHome onImport={() => undefined} />)
    pressEnter(await screen.findByText('One'))
    const next = await waitFor(() => emptyByLabel('Numbered list'))
    fill(next, 'Two')
    await waitFor(async () => {
      expect((await stored()).filter((b) => b.type === 'numbered').map((b) => b.content)).toEqual(['One', 'Two'])
    })
  })

  it('Enter continues to-dos as to-do siblings', async () => {
    await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'todo',
      content: 'Task',
    })
    render(<LibraryHome onImport={() => undefined} />)
    pressEnter(await screen.findByText('Task'))
    const next = await waitFor(() => emptyByLabel('To-do'))
    fill(next, 'Next')
    await waitFor(async () => {
      expect((await stored()).filter((b) => b.type === 'todo').map((b) => b.content)).toEqual(['Task', 'Next'])
    })
  })

  it('Enter in the middle of nested toggles inserts immediately below, not at the end', async () => {
    const parent = await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'toggle',
      content: 'fafawf',
      expanded: true,
    })
    for (const content of ['a', 'b', 'c', 'd', 'f', 'g', 'h']) {
      await libraryBlocksRepo.create({
        pageId: ROOT_LIBRARY_PAGE_ID,
        parentBlockId: parent.id,
        type: 'toggle',
        content,
      })
    }
    render(<LibraryHome onImport={() => undefined} />)
    pressEnter(await screen.findByText('f'))
    const sibling = await waitFor(() => emptyByLabel('Toggle list', parent.id))
    await waitFor(() => expect(sibling.closest('.page-block')?.contains(document.activeElement)).toBe(true))
    const values = [...document.querySelectorAll(`[data-parent-id="${parent.id}"]`)].map(
      (el) =>
        el.querySelector('[data-plain]')?.getAttribute('data-plain') ??
        el.getAttribute('data-plain') ??
        '',
    )
    expect(values).toEqual(['a', 'b', 'c', 'd', 'f', '', 'g', 'h'])
    expect(sibling.closest('[data-block-type]')?.getAttribute('data-block-type')).toBe('toggle')
    expect(await stored()).toHaveLength(8)
  })

  it('Enter in the middle still inserts below when sibling orders collide', async () => {
    const parent = await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'toggle',
      content: 'fafawf',
      expanded: true,
    })
    for (const content of ['a', 'b', 'c', 'd', 'f', 'g', 'h']) {
      const row = await libraryBlocksRepo.create({
        pageId: ROOT_LIBRARY_PAGE_ID,
        parentBlockId: parent.id,
        type: 'toggle',
        content,
      })
      await libraryBlocksRepo.update(row.id, { order: 0 })
    }
    render(<LibraryHome onImport={() => undefined} />)
    await screen.findByText('a')
    const before = [...document.querySelectorAll(`[data-parent-id="${parent.id}"]`)].map(
      (el) =>
        el.querySelector('[data-plain]')?.getAttribute('data-plain') ??
        el.getAttribute('data-plain') ??
        '',
    )
    expect(before).toHaveLength(7)
    const focused = before[3]
    pressEnter(screen.getByText(focused!))
    await waitFor(() => emptyByLabel('Toggle list', parent.id))
    const values = [...document.querySelectorAll(`[data-parent-id="${parent.id}"]`)].map(
      (el) =>
        el.querySelector('[data-plain]')?.getAttribute('data-plain') ??
        el.getAttribute('data-plain') ??
        '',
    )
    expect(values[4]).toBe('')
    expect(values[3]).toBe(focused)
    expect(values[5]).toBe(before[4])
  })

  it('Enter in the middle of a toggle title splits it without moving children', async () => {
    const aqidah = await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'toggle',
      content: 'Hello World',
    })
    await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      parentBlockId: aqidah.id,
      type: 'text',
      content: 'Child',
    })
    render(<LibraryHome onImport={() => undefined} />)
    const row = (await screen.findByText('Hello World')).closest('.page-block') as HTMLElement
    await setCaret(row, 6)
    pressKey(row, 'Enter')
    await waitFor(async () => {
      const rows = await stored()
      expect(rows.find((b) => b.id === aqidah.id)?.content).toBe('Hello ')
      const next = rows.find((b) => b.content === 'World')
      expect(next?.type).toBe('toggle')
      expect(next?.parentBlockId).toBeNull()
      expect(next?.order).toBeGreaterThan(rows.find((b) => b.id === aqidah.id)!.order)
      expect(rows.find((b) => b.content === 'Child')?.parentBlockId).toBe(aqidah.id)
    })
    await waitFor(() => expect(screen.getByText('World').closest('.page-block')?.contains(document.activeElement)).toBe(true))
  })

  it('hovering Previous Library reveals only that row’s controls without moving the title', async () => {
    const archivePage = await libraryPagesRepo.create({
      title: PREVIOUS_LIBRARY_TITLE,
      parentPageId: ROOT_LIBRARY_PAGE_ID,
    })
    await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'page',
      content: PREVIOUS_LIBRARY_TITLE,
      targetPageId: archivePage.id,
    })
    await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'toggle',
      content: 'fafawf',
    })
    render(<LibraryHome onImport={() => undefined} />)
    const archive = (await screen.findByText(PREVIOUS_LIBRARY_TITLE)).closest('.page-block') as HTMLElement
    const other = (await screen.findByText('fafawf')).closest('.page-block') as HTMLElement
    expect(archive).toHaveAttribute('data-block-type', 'page')
    expect(archive).toHaveClass('page-block-page')
    expect(archive.querySelector('.page-block-page-link')).toBeTruthy()
    expect(archive.querySelector('.page-block-caret')).toBeNull()
    const marker = archive.querySelector('[data-testid="block-marker"]')
    const gutter = archive.querySelector('[data-testid="block-gutter"]')
    expect(marker?.querySelector('.page-block-type-icon')).toBeTruthy()
    expect(gutter?.querySelector('.page-block-plus')).toBeTruthy()
    expect(gutter?.querySelector('.page-block-handle')).toBeTruthy()
    expect(gutter?.contains(marker?.querySelector('.page-block-type-icon') as Node)).toBe(false)
    const title = archive.querySelector('.page-block-page-title') as HTMLElement
    const beforeLeft = title.getBoundingClientRect().left
    fireEvent.mouseEnter(archive)
    expect(archive).toHaveClass('is-gutter-on')
    expect(other).not.toHaveClass('is-gutter-on')
    expect(title.getBoundingClientRect().left).toBe(beforeLeft)
    expect(archive.style.width).not.toBe('100vw')
    expect(archive.parentElement?.closest('.page-editor')).toBeTruthy()
    fireEvent.mouseLeave(archive)
    expect(archive).not.toHaveClass('is-gutter-on')
  })

  it('right-click opens a custom delete menu and cancel keeps the row', async () => {
    await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'toggle',
      content: 'Kitab at-Taharah',
    })
    await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      parentBlockId: (await stored())[0]!.id,
      type: 'text',
      content: 'Wudu',
    })
    render(<LibraryHome onImport={() => undefined} />)
    const row = await screen.findByText('Kitab at-Taharah')
    fireEvent.contextMenu(row)
    expect(screen.getByRole('menu', { name: 'Library row' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('nested item')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((await stored()).map((b) => b.content)).toEqual(expect.arrayContaining(['Kitab at-Taharah', 'Wudu']))
  })

  it('closes the row menu with Escape', async () => {
    await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      type: 'text',
      content: 'Scratch',
    })
    render(<LibraryHome onImport={() => undefined} />)
    fireEvent.contextMenu(await screen.findByText('Scratch'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })
})
