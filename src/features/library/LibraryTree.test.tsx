import Dexie from 'dexie'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(async () => {
  // Let any queued outline commits / rAF focus handlers finish before the next seed.
  await act(async () => {
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
  })
})

describe('LibraryTree outline editing', () => {
  it('does not persist a draft until a non-empty title is committed', async () => {
    const { book } = await seedBook()
    render(<LibraryTree variant="home" />)

    await waitFor(() => expect(screen.getByText('Kitāb at-Tawḥīd')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Add under Kitāb at-Tawḥīd/i }))

    await waitFor(() => expect(screen.getByLabelText('Title')).toBeInTheDocument())
    expect(await libraryRepo.children(book.id)).toHaveLength(0)
    expect(screen.queryByText('Untitled')).toBeNull()
    expect(screen.queryByText(/New item/i)).toBeNull()
  })

  it('expanding an empty item opens a draft line without clicking +', async () => {
    const { book } = await seedBook()
    await libraryRepo.update(book.id, { collapsed: true })
    render(<LibraryTree variant="home" />)

    await waitFor(() => expect(screen.getByText('Kitāb at-Tawḥīd')).toBeInTheDocument())
    const bookRow = screen.getByText('Kitāb at-Tawḥīd').closest('.lib-row')
    const caret = bookRow?.querySelector('button.lib-caret')
    expect(caret).toBeTruthy()
    fireEvent.click(caret!)

    await waitFor(() => expect(screen.getByLabelText('Title')).toBeInTheDocument())
    expect(await libraryRepo.children(book.id)).toHaveLength(0)
    expect(screen.queryByText(/New item/i)).toBeNull()
    // Stay in Library — expanding a toggle must not open Study.
    expect(useLibraryStore.getState().activeNodeId).toBeNull()
  })

  it('clicking an empty item starts writing under it like a Notion toggle', async () => {
    const { book } = await seedBook()
    await libraryRepo.update(book.id, { collapsed: true })
    render(<LibraryTree variant="home" />)

    fireEvent.click(await waitFor(() => screen.getByText('Kitāb at-Tawḥīd')))
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeInTheDocument())
    expect(await libraryRepo.children(book.id)).toHaveLength(0)
    // Writing the outline must not yank you into Study.
    expect(useLibraryStore.getState().activeNodeId).toBeNull()
  })

  it('Enter on a row starts the next sibling line without +', async () => {
    const { book } = await seedBook()
    const chapter = await libraryRepo.create({
      parentId: book.id,
      type: 'chapter',
      title: 'Bāb',
    })
    render(<LibraryTree variant="home" />)

    const label = (await waitFor(() => screen.getByText('Bāb'))).closest('button.lib-label')
    expect(label).toBeTruthy()
    fireEvent.keyDown(label!, { key: 'Enter' })

    await waitFor(() => expect(screen.getByLabelText('Title')).toBeInTheDocument())
    expect(await libraryRepo.children(book.id)).toHaveLength(1)
    expect((await db.libraryNodes.get(chapter.id))?.title).toBe('Bāb')
  })

  it('Enter commits one node and opens the next sibling draft', async () => {
    const promptSpy = vi.spyOn(window, 'prompt')
    const { book } = await seedBook()
    render(<LibraryTree variant="home" />)

    await waitFor(() => expect(screen.getByText('Kitāb at-Tawḥīd')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Add under Kitāb at-Tawḥīd/i }))

    let input = await waitFor(() => screen.getByLabelText('Title'))
    fireEvent.change(input, { target: { value: 'Benefit One' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByText('Benefit One')).toBeInTheDocument())
    input = await waitFor(() => {
      const el = screen.getByLabelText('Title') as HTMLInputElement
      expect(el.value).toBe('')
      return el
    })

    // Ensure the first commit chain has fully settled before the next title.
    await act(async () => {
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
    })
    input = screen.getByLabelText('Title') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Benefit Two' } })
    await waitFor(() => {
      expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Benefit Two')
    })
    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Enter' })

    await waitFor(async () => {
      const kids = await libraryRepo.children(book.id)
      expect(kids.map((k) => k.title)).toEqual(['Benefit One', 'Benefit Two'])
    })
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
    expect(promptSpy).not.toHaveBeenCalled()
    promptSpy.mockRestore()
  })

  it('Escape cancels a draft without writing to the database', async () => {
    const { book } = await seedBook()
    render(<LibraryTree variant="home" />)

    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Add under Kitāb/i })))
    const input = await waitFor(() => screen.getByLabelText('Title'))
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Will cancel' } })
      fireEvent.keyDown(input, { key: 'Escape' })
    })

    await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull())
    expect(await libraryRepo.children(book.id)).toHaveLength(0)
  })

  it('empty Backspace cancels the draft and focuses the previous title', async () => {
    const { book } = await seedBook()
    await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'Kept' })
    render(<LibraryTree variant="home" />)

    await waitFor(() => expect(screen.getByText('Kept')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Add under Kitāb at-Tawḥīd/i }))
    const input = await waitFor(() => screen.getByLabelText('Title'))
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

    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Add under Kitāb/i })))
    const input = await waitFor(() => screen.getByLabelText('Title'))
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

    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Add under Kitāb/i })))
    let input = await waitFor(() => screen.getByLabelText('Title'))
    await act(async () => {
      fireEvent.change(input, { target: { value: 'L1' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    await waitFor(() => expect(screen.getByText('L1')).toBeInTheDocument())
    await act(async () => {
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
    })

    // TYPE → TAB (nest) → ENTER (next draft) at each deeper level.
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
      // Tab leaves the new node in rename mode.
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

  it('reload keeps committed nodes only — not the open draft', async () => {
    const { book } = await seedBook()
    await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'One' })
    await libraryRepo.create({ parentId: book.id, type: 'chapter', title: 'Two' })

    const { unmount } = render(<LibraryTree variant="home" />)
    await waitFor(() => expect(screen.getByText('Two')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Add under Kitāb/i }))
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeInTheDocument())
    unmount()

    render(<LibraryTree variant="home" />)
    await waitFor(() => {
      expect(screen.getByText('One')).toBeInTheDocument()
      expect(screen.getByText('Two')).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Title')).toBeNull()
    const kids = await libraryRepo.children(book.id)
    expect(kids.map((k) => k.title)).toEqual(['One', 'Two'])
  })

  it('persists mixed Arabic/English titles', async () => {
    const { book } = await seedBook()
    render(<LibraryTree variant="home" />)

    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Add under Kitāb/i })))
    const input = await waitFor(() => screen.getByLabelText('Title'))
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Chapter — باب الخوف من الشرك' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    await waitFor(async () => {
      const kids = await libraryRepo.children(book.id)
      expect(kids[0]?.title).toBe('Chapter — باب الخوف من الشرك')
    })
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
    fireEvent.click(title)
    expect(screen.queryByLabelText('Title')).toBeNull()
    await waitFor(() => expect(useLibraryStore.getState().activeNodeId).toBe(chapter.id))

    fireEvent.doubleClick(screen.getByText('Navigate me'))
    expect(await waitFor(() => screen.getByLabelText('Title'))).toBeInTheDocument()
  })
})
