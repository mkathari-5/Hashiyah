import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { db } from '@/db/db'
import { libraryBlocksRepo, ROOT_LIBRARY_PAGE_ID } from '@/db/repos/libraryPages'
import { LibraryHome } from '@/features/library/LibraryHome'
import { richFromPlain } from '@/lib/richTitle'
import { useLibraryStore } from '@/state/useLibraryStore'

beforeEach(async () => {
  await Dexie.waitFor(db.open())
  await Promise.all(db.tables.map((t) => t.clear()))
  useLibraryStore.setState({ activeNodeId: null })
})

describe('rich library titles', () => {
  it('renders stored marks for an unfocused row without mounting an editor', async () => {
    await libraryBlocksRepo.create({
      pageId: ROOT_LIBRARY_PAGE_ID,
      parentBlockId: null,
      type: 'text',
      content: 'Kitab at-Taharah',
      richContent: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Kitab ', marks: [{ type: 'bold' }] },
              { type: 'text', text: 'at-Taharah', marks: [{ type: 'textStyle', attrs: { color: '#8a6a3b' } }] },
            ],
          },
        ],
      },
    })
    render(<LibraryHome onImport={() => undefined} />)
    expect(await screen.findByText('Kitab')).toBeInTheDocument()
    expect(screen.getByText('at-Taharah')).toBeInTheDocument()
    expect(document.querySelector('.rich-title-span.is-bold')?.textContent).toBe('Kitab ')
    expect(document.querySelectorAll('[data-title-editor]').length).toBeLessThan(3)
  })

  it('keeps the plain title as the searchable fallback', () => {
    const rich = richFromPlain('Kitab at-Taharah')
    expect(JSON.stringify(rich)).not.toContain('<')
  })
})
