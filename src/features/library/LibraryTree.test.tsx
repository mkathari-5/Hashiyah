import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  const chapter = await libraryRepo.create({
    parentId: book.id,
    type: 'chapter',
    title: 'Chapter 3',
  })
  await libraryRepo.update(science.id, { collapsed: false })
  await libraryRepo.update(book.id, { collapsed: false })
  return { science, book, chapter }
}

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
  useLibraryStore.setState({ activeNodeId: null })
})

describe('LibraryTree study sidebar', () => {
  it('renders existing study material without lib-add or Add under controls', async () => {
    await seedBook()
    render(<LibraryTree variant="sidebar" />)

    await waitFor(() => expect(screen.getByText('Kitāb at-Tawḥīd')).toBeInTheDocument())
    expect(screen.getByText('Chapter 3')).toBeInTheDocument()
    expect(screen.queryByText(/New item/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Add under/i })).toBeNull()
    expect(document.querySelector('.lib-add')).toBeNull()
    expect(document.querySelector('.lib-composer')).toBeNull()
  })

  it('opens Study when a row is clicked', async () => {
    const { chapter } = await seedBook()
    render(<LibraryTree variant="sidebar" />)

    fireEvent.click(await waitFor(() => screen.getByText('Chapter 3')))
    await waitFor(() => expect(useLibraryStore.getState().activeNodeId).toBe(chapter.id))
  })

  it('emphasises the ancestral path of the selected node', async () => {
    const { chapter } = await seedBook()
    useLibraryStore.setState({ activeNodeId: chapter.id })
    render(<LibraryTree variant="sidebar" />)

    await waitFor(() => expect(screen.getByText('Chapter 3')).toBeInTheDocument())
    expect(screen.getByText('ʿAqīdah').closest('.lib-row')).toHaveClass('is-ancestor')
    expect(screen.getByText('Kitāb at-Tawḥīd').closest('.lib-row')).toHaveClass('is-ancestor')
    expect(screen.getByText('Chapter 3').closest('.lib-row')).toHaveClass('is-selected')
    expect(screen.getByText('Chapter 3').closest('.lib-row')).not.toHaveClass('is-ancestor')
  })

  it('expanding an empty container does not create a child or a draft', async () => {
    const science = await libraryRepo.create({ parentId: null, type: 'science', title: 'Fiqh' })
    await libraryRepo.update(science.id, { collapsed: true })
    render(<LibraryTree variant="sidebar" />)

    const row = await waitFor(() => screen.getByText('Fiqh').closest('.lib-row'))
    fireEvent.click(row!.querySelector('button.lib-caret')!)
    await waitFor(() => expect(row!.querySelector('button.lib-caret')).toHaveAttribute('aria-expanded', 'true'))
    expect(screen.queryByLabelText('Title')).toBeNull()
    expect(await libraryRepo.children(science.id)).toHaveLength(0)
  })
})
