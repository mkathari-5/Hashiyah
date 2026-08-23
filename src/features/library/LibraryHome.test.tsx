import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
      expect(screen.getByDisplayValue(PREVIOUS_LIBRARY_TITLE)).toBeInTheDocument()
    })
    expect(document.querySelector('.lib-tree')).toBeNull()
    expect(screen.queryByText('Your library is empty.')).toBeNull()
  })
})
