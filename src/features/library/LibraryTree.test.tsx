import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
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

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
  useLibraryStore.setState({ activeNodeId: null })
})

describe('LibraryTree outline editing', () => {
  it('creates consecutive chapters with Enter and no prompt', async () => {
    const promptSpy = vi.spyOn(window, 'prompt')
    const { book } = await seedBook()
    render(<LibraryTree variant="home" />)

    await waitFor(() => expect(screen.getByText('Kitāb at-Tawḥīd')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /New item/i }))

    let input = await waitFor(() => screen.getByLabelText('Title'))
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Chapter One' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    await waitFor(() => expect(screen.getByText('Chapter One')).toBeInTheDocument())
    input = await waitFor(() => screen.getByLabelText('Title'))
    expect((input as HTMLInputElement).value).toBe('')

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Chapter Two' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    await waitFor(() => expect(screen.getByText('Chapter Two')).toBeInTheDocument())

    input = await waitFor(() => screen.getByLabelText('Title'))
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Chapter Three' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    await waitFor(() => {
      expect(screen.getByText('Chapter One')).toBeInTheDocument()
      expect(screen.getByText('Chapter Two')).toBeInTheDocument()
      expect(screen.getByText('Chapter Three')).toBeInTheDocument()
    })

    await waitFor(async () => {
      const kids = await libraryRepo.children(book.id)
      expect(kids.map((k) => k.title).filter(Boolean)).toEqual([
        'Chapter One',
        'Chapter Two',
        'Chapter Three',
      ])
      expect(kids.some((k) => k.title === '')).toBe(true)
    })
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeInTheDocument())
    expect(promptSpy).not.toHaveBeenCalled()
    promptSpy.mockRestore()
  })

  it('renames inline; Escape cancels', async () => {
    const { book } = await seedBook()
    const chapter = await libraryRepo.create({
      parentId: book.id,
      type: 'chapter',
      title: 'What came regardng Sihr',
    })
    render(<LibraryTree variant="home" />)

    const label = await waitFor(() => screen.getByText('What came regardng Sihr'))
    fireEvent.doubleClick(label)

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

  it('Backspace on an empty draft removes it and focuses the previous title', async () => {
    const { book } = await seedBook()
    await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'Kept' })
    render(<LibraryTree variant="home" />)

    await waitFor(() => expect(screen.getByText('Kept')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /New item/i }))
    const input = await waitFor(() => screen.getByLabelText('Title'))
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Backspace' })
    })

    await waitFor(async () => {
      const kids = await libraryRepo.children(book.id)
      expect(kids.map((k) => k.title)).toEqual(['Kept'])
    })
    await waitFor(() => {
      const editing = screen.getByLabelText('Title') as HTMLInputElement
      expect(editing.value).toBe('Kept')
    })
  })

  it('Tab indents under the previous chapter when valid', async () => {
    const { book } = await seedBook()
    const a = await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'Chapter 1' })
    const b = await libraryRepo.create({
      parentId: book.id,
      type: 'chapter',
      title: 'Meaning of Tawḥīd',
    })
    render(<LibraryTree variant="home" />)

    fireEvent.doubleClick(await waitFor(() => screen.getByText('Meaning of Tawḥīd')))
    const input = await waitFor(() => screen.getByLabelText('Title'))
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Tab' })
    })

    await waitFor(async () => {
      const moved = await db.libraryNodes.get(b.id)
      expect(moved?.parentId).toBe(a.id)
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
      const moved = await db.libraryNodes.get(b.id)
      expect(moved?.parentId).toBe(book.id)
    })
  })

  it('persists outline structure after remount (reload)', async () => {
    const { book } = await seedBook()
    await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'One' })
    await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'Two' })

    const { unmount } = render(<LibraryTree variant="home" />)
    await waitFor(() => expect(screen.getByText('Two')).toBeInTheDocument())
    unmount()

    render(<LibraryTree variant="home" />)
    await waitFor(() => {
      expect(screen.getByText('One')).toBeInTheDocument()
      expect(screen.getByText('Two')).toBeInTheDocument()
    })
    const kids = await libraryRepo.children(book.id)
    expect(kids.map((k) => k.title)).toEqual(['One', 'Two'])
  })

  it('single click navigates; double-click starts inline edit', async () => {
    const { book } = await seedBook()
    const chapter = await libraryRepo.create({
      parentId: book.id,
      type: 'chapter',
      title: 'Navigate me',
    })

    render(<LibraryTree variant="sidebar" />)
    const title = await waitFor(() => screen.getByText('Navigate me'))
    // Single click must not enter edit mode.
    fireEvent.click(title)
    expect(screen.queryByLabelText('Title')).toBeNull()
    await waitFor(() => expect(useLibraryStore.getState().activeNodeId).toBe(chapter.id))

    fireEvent.doubleClick(screen.getByText('Navigate me'))
    expect(await waitFor(() => screen.getByLabelText('Title'))).toBeInTheDocument()
  })
})
