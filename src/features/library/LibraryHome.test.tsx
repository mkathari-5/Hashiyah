import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import { LibraryHome } from '@/features/library/LibraryHome'
import { PREVIOUS_LIBRARY_TITLE } from '@/features/library/libraryPageModel'

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('LibraryHome', () => {
  it('renders a page editor rather than LibraryTree', async () => {
    render(<LibraryHome onImport={() => undefined} />)

    expect(await screen.findByLabelText('Page title')).toHaveValue('Library')
    expect(await screen.findByLabelText('Text')).toBeInTheDocument()
    expect(document.querySelector('.lib-tree')).toBeNull()
    expect(screen.queryByText('Your library is empty.')).toBeNull()
    expect(screen.queryByText(/Add under/i)).toBeNull()
  })

  it('imports existing study titles under Previous Library instead of outlining them', async () => {
    await libraryRepo.create({
      parentId: null,
      type: 'science',
      title: 'Aqīdah',
      arabicTitle: 'العقيدة',
    })

    render(<LibraryHome onImport={() => undefined} />)

    await waitFor(() => {
      expect(screen.getByText(PREVIOUS_LIBRARY_TITLE)).toBeInTheDocument()
    })
    const archive = screen.getByText(PREVIOUS_LIBRARY_TITLE).closest('[data-block-type]')
    expect(archive).toHaveAttribute('data-block-type', 'page')
    expect(archive?.querySelector('.page-block-caret')).toBeNull()
    expect(screen.queryByLabelText('Expand')).toBeNull()
    expect(screen.queryByPlaceholderText("Type '/' for commands")).toBeNull()
    expect(document.querySelector('.lib-tree')).toBeNull()
    expect(screen.queryByText('Your library is empty.')).toBeNull()

    fireEvent.click(screen.getByText(PREVIOUS_LIBRARY_TITLE))
    await waitFor(() => {
      expect(screen.getByLabelText('Page title')).toHaveValue(PREVIOUS_LIBRARY_TITLE)
    })
    expect(await screen.findByText('Aqīdah — العقيدة')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    await waitFor(() => {
      expect(screen.getByLabelText('Page title')).toHaveValue('Library')
    })
  })
})
