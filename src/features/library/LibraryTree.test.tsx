import Dexie from 'dexie'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import { notesRepo } from '@/db/repos/notes'
import { LibraryTree } from '@/features/library/LibraryTree'
import { useLibraryStore } from '@/state/useLibraryStore'

async function seedBook() {
  const science = await libraryRepo.create({
    parentId: null,
    type: 'science',
    title: 'ʿAqīdah',
  })
  const book = await libraryRepo.create({
    parentId: science.id,
    type: 'book',
    title: 'Kitāb at-Tawḥīd',
  })
  await libraryRepo.update(science.id, { collapsed: false })
  await libraryRepo.update(book.id, { collapsed: false })
  return { science, book }
}

function assertNoPlusControls() {
  expect(screen.queryByText(/New item/i)).toBeNull()
  expect(screen.queryByText(/\+ New item/i)).toBeNull()
  expect(screen.queryByRole('button', { name: /Add under/i })).toBeNull()
  expect(document.querySelector('.lib-add')).toBeNull()
  expect(document.querySelector('.lib-composer')).toBeNull()
}

function rowOf(title: string) {
  return screen.getByText(title).closest('.lib-row')
}

async function expandRow(title: string) {
  await waitFor(() => expect(screen.getByText(title)).toBeInTheDocument())
  const caret = rowOf(title)?.querySelector('button.lib-caret')
  expect(caret).toBeTruthy()
  fireEvent.click(caret!)
}

/** Notion path: click an empty container to open a draft (no + control). */
async function openDraftUnderEmptyBook() {
  fireEvent.click(await waitFor(() => screen.getByText('Kitāb at-Tawḥīd')))
  return waitFor(() => screen.getByLabelText('Title'))
}

/** Notion path: Enter on a row to start the next sibling draft. */
async function openSiblingDraftAfter(title: string) {
  const label = (await waitFor(() => screen.getByText(title))).closest('button.lib-label')
  expect(label).toBeTruthy()
  fireEvent.keyDown(label!, { key: 'Enter' })
  return waitFor(() => screen.getByLabelText('Title'))
}

function draftRow() {
  return document.querySelector('[data-lib-row="draft"]')
}

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
  useLibraryStore.setState({ activeNodeId: null })
})

afterEach(async () => {
  await act(async () => {
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
  })
})

describe('LibraryTree outline editing', () => {
  it('does not render + New item, lib-add, or Add under controls', async () => {
    const { book } = await seedBook()
    render(<LibraryTree variant="home" />)

    await openDraftUnderEmptyBook()

    expect(await libraryRepo.children(book.id)).toHaveLength(0)
    expect(screen.queryByText('Untitled')).toBeNull()
    assertNoPlusControls()
  })

  it('expanding an empty top-level container opens one inline draft', async () => {
    const { book } = await seedBook()
    await libraryRepo.update(book.id, { collapsed: true })
    render(<LibraryTree variant="home" />)

    await expandRow('Kitāb at-Tawḥīd')

    const input = await waitFor(() => screen.getByLabelText('Title'))
    expect(await libraryRepo.children(book.id)).toHaveLength(0)
    assertNoPlusControls()
    expect(draftRow()).toBeTruthy()
    expect(draftRow()?.querySelector('.lib-caret')).toBeTruthy()
    expect(draftRow()?.querySelector('.lib-label')).toBeTruthy()
    expect(input.closest('.lib-label')).toBeTruthy()
    expect(useLibraryStore.getState().activeNodeId).toBeNull()
  })

  it('expanding an empty nested chapter/Faaidah opens the same type of draft', async () => {
    const { book } = await seedBook()
    const faaidah = await libraryRepo.create({
      parentId: book.id,
      type: 'chapter',
      title: 'Faaidah',
    })
    await libraryRepo.update(faaidah.id, { collapsed: true })
    render(<LibraryTree variant="home" />)

    await expandRow('Faaidah')

    const input = await waitFor(() => screen.getByLabelText('Title'))
    expect(await libraryRepo.children(faaidah.id)).toHaveLength(0)
    expect(draftRow()?.className).toMatch(/lib-row-chapter/)
    expect(input.closest('[data-lib-row="draft"]')).toBeTruthy()
    expect(useLibraryStore.getState().activeNodeId).toBeNull()
  })

  it('clicking an empty nested item starts writing without leaving Library', async () => {
    const { book } = await seedBook()
    await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'Faaidah' })
    render(<LibraryTree variant="home" />)

    fireEvent.click(await waitFor(() => screen.getByText('Faaidah')))
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeInTheDocument())
    expect(useLibraryStore.getState().activeNodeId).toBeNull()
  })

  it('creates a deeply nested item without leaving Library', async () => {
    const { book } = await seedBook()
    const faaidah = await libraryRepo.create({
      parentId: book.id,
      type: 'chapter',
      title: 'Faaidah',
    })
    await libraryRepo.update(faaidah.id, { collapsed: true })
    render(<LibraryTree variant="sidebar" />)

    await expandRow('Faaidah')
    const input = await waitFor(() => screen.getByLabelText('Title'))
    fireEvent.change(input, { target: { value: 'Exception' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(async () => {
      const kids = await libraryRepo.children(faaidah.id)
      expect(kids.map((k) => k.title)).toEqual(['Exception'])
    })
    expect(useLibraryStore.getState().activeNodeId).toBeNull()
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
  })

  it('Enter with a valid title persists exactly one trimmed node and opens the next sibling draft', async () => {
    const promptSpy = vi.spyOn(window, 'prompt')
    const { book } = await seedBook()
    render(<LibraryTree variant="home" />)

    let input = await openDraftUnderEmptyBook()
    fireEvent.change(input, { target: { value: '  Benefit One  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByText('Benefit One')).toBeInTheDocument())
    await waitFor(async () => {
      const kids = await libraryRepo.children(book.id)
      expect(kids.map((k) => k.title)).toEqual(['Benefit One'])
    })

    input = await waitFor(() => {
      const el = screen.getByLabelText('Title') as HTMLInputElement
      expect(el.value).toBe('')
      return el
    })
    expect(input.closest('[data-lib-row="draft"]')).toBeTruthy()
    expect(promptSpy).not.toHaveBeenCalled()
    promptSpy.mockRestore()
  })

  it('Enter with blank or whitespace-only input persists nothing', async () => {
    const { book } = await seedBook()
    render(<LibraryTree variant="home" />)

    const input = await openDraftUnderEmptyBook()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await act(async () => {
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(await libraryRepo.children(book.id)).toHaveLength(0)
    expect(screen.queryByText('Untitled')).toBeNull()
  })

  it('Escape cancels a draft without writing to the database', async () => {
    const { book } = await seedBook()
    render(<LibraryTree variant="home" />)

    const input = await openDraftUnderEmptyBook()
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Will cancel' } })
      fireEvent.keyDown(input, { key: 'Escape' })
    })

    await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull())
    expect(await libraryRepo.children(book.id)).toHaveLength(0)
  })

  it('blur of an empty draft persists nothing', async () => {
    const { book } = await seedBook()
    render(<LibraryTree variant="home" />)

    const input = await openDraftUnderEmptyBook()
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r))
      await new Promise((r) => setTimeout(r, 0))
    })
    fireEvent.blur(input)

    await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull())
    expect(await libraryRepo.children(book.id)).toHaveLength(0)
  })

  it('collapse of an empty draft persists nothing', async () => {
    const { book } = await seedBook()
    await libraryRepo.update(book.id, { collapsed: true })
    render(<LibraryTree variant="home" />)

    await expandRow('Kitāb at-Tawḥīd')
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeInTheDocument())
    await expandRow('Kitāb at-Tawḥīd')

    await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull())
    expect(await libraryRepo.children(book.id)).toHaveLength(0)
  })

  it('draft and persisted rows use the same structural row layout and caret alignment', async () => {
    const { book } = await seedBook()
    await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'Kept' })
    render(<LibraryTree variant="home" />)

    const persisted = await waitFor(() => rowOf('Kept'))
    expect(persisted?.querySelector(':scope > .lib-caret')).toBeTruthy()
    expect(persisted?.querySelector(':scope > .lib-label')).toBeTruthy()

    await openSiblingDraftAfter('Kept')
    const draft = await waitFor(() => draftRow())
    expect(draft?.querySelector(':scope > .lib-caret')).toBeTruthy()
    expect(draft?.querySelector(':scope > .lib-label')).toBeTruthy()
    expect(draft?.querySelector('.lib-title-input')).toBeTruthy()
    expect(draft?.querySelector('.lib-inline-input')).toBeNull()
    expect(draft?.querySelector('.lib-caret svg')).toBeTruthy()
  })

  it('empty Backspace cancels the draft and focuses the previous title', async () => {
    const { book } = await seedBook()
    await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'Kept' })
    render(<LibraryTree variant="home" />)

    const input = await openSiblingDraftAfter('Kept')
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Backspace' })
    })

    await waitFor(async () => {
      expect(await libraryRepo.children(book.id)).toHaveLength(1)
    })
    await waitFor(() => {
      expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Kept')
    })
  })

  it('Tab nests a committed draft under the previous sibling', async () => {
    const { book } = await seedBook()
    await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'Parent' })
    render(<LibraryTree variant="home" />)

    const input = await openSiblingDraftAfter('Parent')
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Child' } })
      fireEvent.keyDown(input, { key: 'Tab' })
    })

    await waitFor(async () => {
      const parent = (await libraryRepo.children(book.id)).find((n) => n.title === 'Parent')
      expect(parent).toBeTruthy()
      const kids = await libraryRepo.children(parent!.id)
      expect(kids.map((k) => k.title)).toEqual(['Child'])
    })
  })

  it('Shift+Tab outdents one level when valid', async () => {
    const { book } = await seedBook()
    const a = await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'Chapter 1' })
    await libraryRepo.update(a.id, { collapsed: false })
    const b = await libraryRepo.create({
      parentId: a.id,
      type: 'chapter',
      title: 'Meaning of Tawḥīd',
    })
    render(<LibraryTree variant="home" />)

    fireEvent.doubleClick(await waitFor(() => screen.getByText('Meaning of Tawḥīd')))
    const input = await waitFor(() => screen.getByLabelText('Title'))
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
    })

    await waitFor(async () => {
      expect((await db.libraryNodes.get(b.id))?.parentId).toBe(book.id)
    })
  })

  it('renames inline; Escape restores the previous title', async () => {
    const { book } = await seedBook()
    const chapter = await libraryRepo.create({
      parentId: book.id,
      type: 'chapter',
      title: 'What came regardng Sihr',
    })
    render(<LibraryTree variant="home" />)

    fireEvent.doubleClick(await waitFor(() => screen.getByText('What came regardng Sihr')))
    const input = await waitFor(() => screen.getByLabelText('Title'))
    await act(async () => {
      fireEvent.change(input, { target: { value: 'What came regarding Siḥr' } })
      fireEvent.keyDown(input, { key: 'Escape' })
    })

    await waitFor(() => expect(screen.getByText('What came regardng Sihr')).toBeInTheDocument())
    expect((await db.libraryNodes.get(chapter.id))?.title).toBe('What came regardng Sihr')

    fireEvent.doubleClick(screen.getByText('What came regardng Sihr'))
    const again = await waitFor(() => screen.getByLabelText('Title'))
    await act(async () => {
      fireEvent.change(again, { target: { value: 'What came regarding Siḥr' } })
      fireEvent.keyDown(again, { key: 'Enter' })
    })
    await waitFor(() => expect(screen.getByText('What came regarding Siḥr')).toBeInTheDocument())
    expect((await db.libraryNodes.get(chapter.id))?.title).toBe('What came regarding Siḥr')
  })

  it('supports recursive creation at 6+ levels', async () => {
    const { book } = await seedBook()
    render(<LibraryTree variant="home" />)

    let input = await openDraftUnderEmptyBook()
    await act(async () => {
      fireEvent.change(input, { target: { value: 'L1' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    await waitFor(() => expect(screen.getByText('L1')).toBeInTheDocument())
    await act(async () => {
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
    })

    for (let level = 2; level <= 6; level++) {
      input = await waitFor(() => {
        const el = screen.getByLabelText('Title') as HTMLInputElement
        expect(el.value).toBe('')
        return el
      })
      await act(async () => {
        fireEvent.change(input, { target: { value: `L${level}` } })
        fireEvent.keyDown(input, { key: 'Tab' })
      })

      await waitFor(async () => {
        let parentId = book.id
        for (let i = 1; i < level; i++) {
          const kids = await libraryRepo.children(parentId)
          const hit = kids.find((k) => k.title === `L${i}`)
          expect(hit).toBeTruthy()
          parentId = hit!.id
        }
        const nested = await libraryRepo.children(parentId)
        expect(nested.some((k) => k.title === `L${level}`)).toBe(true)
      })
      await waitFor(() => {
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(`L${level}`)
      })

      input = screen.getByLabelText('Title')
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' })
      })
      await waitFor(() => {
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('')
      })
      await act(async () => {
        await Promise.resolve()
        await new Promise((r) => setTimeout(r, 0))
      })
    }

    let current = book.id
    for (let level = 1; level <= 6; level++) {
      const kids = await libraryRepo.children(current)
      const hit = kids.find((k) => k.title === `L${level}`)
      expect(hit).toBeTruthy()
      current = hit!.id
    }
  })

  it('reload keeps committed nodes only — not the open draft or an Untitled node', async () => {
    const { book } = await seedBook()
    await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'One' })
    await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'Two' })

    const { unmount } = render(<LibraryTree variant="home" />)
    await openSiblingDraftAfter('Two')
    unmount()

    render(<LibraryTree variant="home" />)
    await waitFor(() => {
      expect(screen.getByText('One')).toBeInTheDocument()
      expect(screen.getByText('Two')).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Title')).toBeNull()
    expect(screen.queryByText('Untitled')).toBeNull()
    const kids = await libraryRepo.children(book.id)
    expect(kids.map((k) => k.title)).toEqual(['One', 'Two'])
    expect(kids.every((k) => k.title.trim().length > 0)).toBe(true)
  })

  it('persists mixed Arabic/English titles', async () => {
    const { book } = await seedBook()
    render(<LibraryTree variant="home" />)

    const input = await openDraftUnderEmptyBook()
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Chapter — باب الخوف من الشرك' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    await waitFor(async () => {
      const kids = await libraryRepo.children(book.id)
      expect(kids[0]?.title).toBe('Chapter — باب الخوف من الشرك')
    })
  })

  it('single click on an item with children opens Study; double-click still renames', async () => {
    const { book } = await seedBook()
    const chapter = await libraryRepo.create({
      parentId: book.id,
      type: 'chapter',
      title: 'Navigate me',
    })
    await libraryRepo.create({
      parentId: chapter.id,
      type: 'chapter',
      title: 'Child',
    })
    await libraryRepo.update(chapter.id, { collapsed: false })

    render(<LibraryTree variant="sidebar" />)
    const title = await waitFor(() => screen.getByText('Navigate me'))
    fireEvent.click(title)
    expect(screen.queryByLabelText('Title')).toBeNull()
    await waitFor(() => expect(useLibraryStore.getState().activeNodeId).toBe(chapter.id))

    fireEvent.doubleClick(screen.getByText('Navigate me'))
    expect(await waitFor(() => screen.getByLabelText('Title'))).toBeInTheDocument()
  })

  it('does not paint Untitled for a blank recovery title that still has notes', async () => {
    const { book } = await seedBook()
    const note = await notesRepo.create({ bookId: null, title: 'Kept notes' })
    await libraryRepo.create({
      parentId: book.id,
      type: 'chapter',
      title: '',
      noteId: note.id,
    })
    render(<LibraryTree variant="home" />)

    await waitFor(() => expect(rowOf('Kitāb at-Tawḥīd')).toBeTruthy())
    expect(screen.queryByText('Untitled')).toBeNull()
    expect(screen.getByLabelText('Empty title')).toBeInTheDocument()
  })
})
