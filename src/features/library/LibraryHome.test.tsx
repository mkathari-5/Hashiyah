import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import { LibraryHome } from '@/features/library/LibraryHome'

/**
 * §F.1 — after the library has resolved, "empty" and "being prepared" must
 * never appear together. Home owns the empty copy; the tree stays silent.
 */

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('LibraryHome empty state', () => {
  it('shows only the empty-library copy once loading has finished', async () => {
    render(<LibraryHome onImport={() => undefined} />)

    await waitFor(() => {
      expect(screen.getByText('Your library is empty.')).toBeInTheDocument()
    })

    expect(screen.queryByText('Your library is being prepared…')).toBeNull()
    expect(screen.getByText('Import a PDF', { selector: '.empty-state-action' })).toBeInTheDocument()
  })

  it('does not show the empty copy when the library has roots', async () => {
    await libraryRepo.create({
      parentId: null,
      type: 'science',
      title: 'Aqīdah',
      arabicTitle: 'العقيدة',
    })

    render(<LibraryHome onImport={() => undefined} />)

    await waitFor(() => {
      expect(screen.getByText('Aqīdah')).toBeInTheDocument()
    })

    expect(screen.queryByText('Your library is empty.')).toBeNull()
    expect(screen.queryByText('Your library is being prepared…')).toBeNull()
  })
})
