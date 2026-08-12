import { describe, expect, it, vi } from 'vitest'
import { BLOCK_CATALOGUE, filterBlocks } from './blockCatalogue'
import { ISLAMIC_PHRASES } from './islamicPhrases'

describe('Islamic insert commands', () => {
  it('exposes /quran and honorific shortcuts in the slash catalogue', () => {
    expect(filterBlocks('quran').some((b) => b.id === 'quranBlock')).toBe(true)
    for (const phrase of ISLAMIC_PHRASES) {
      expect(filterBlocks(phrase.shortcut).some((b) => b.id === `phrase:${phrase.shortcut}`)).toBe(
        true,
      )
    }
    expect(filterBlocks('ﷺ').some((b) => b.id === 'saw-symbol')).toBe(true)
  })

  it('lists honorifics under Islamic text with Arabic + shortcut titles', () => {
    const saw = BLOCK_CATALOGUE.find((b) => b.id === 'phrase:saw')
    expect(saw?.group).toBe('Islamic text')
    expect(saw?.title).toContain('صلى الله عليه وسلم')
    expect(saw?.title).toContain('/saw')
  })

  it.each(ISLAMIC_PHRASES)('inserts $shortcut as inline text, not a block', (phrase) => {
    const entry = BLOCK_CATALOGUE.find((b) => b.id === `phrase:${phrase.shortcut}`)
    expect(entry).toBeTruthy()

    const insertContent = vi.fn().mockReturnValue({ run: () => true })
    const chain = {
      focus: () => ({ insertContent }),
    }
    const editor = { chain: () => chain } as never
    entry!.run(editor)
    expect(insertContent).toHaveBeenCalledWith(phrase.text)
  })
})
