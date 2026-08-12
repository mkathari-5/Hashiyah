import { describe, expect, it, vi } from 'vitest'
import { BLOCK_CATALOGUE, filterBlocks } from './blockCatalogue'

describe('Islamic insert commands', () => {
  it('exposes /quran and /saw in the slash catalogue', () => {
    expect(filterBlocks('quran').some((b) => b.id === 'quranBlock')).toBe(true)
    expect(filterBlocks('saw').some((b) => b.id === 'saw')).toBe(true)
    expect(filterBlocks('ﷺ').some((b) => b.id === 'saw-symbol')).toBe(true)
  })

  it('inserts صلى الله عليه وسلم as inline text, not a block', () => {
    const saw = BLOCK_CATALOGUE.find((b) => b.id === 'saw')
    expect(saw).toBeTruthy()

    const insertContent = vi.fn().mockReturnValue({ run: () => true })
    const chain = {
      focus: () => ({ insertContent }),
    }
    const editor = { chain: () => chain } as never
    saw!.run(editor)
    expect(insertContent).toHaveBeenCalledWith('صلى الله عليه وسلم')
  })
})
