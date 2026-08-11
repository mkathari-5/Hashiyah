import { describe, expect, it } from 'vitest'
import { displayTitle, secondaryTitle, titleFromFilename } from './bookTitle'

const FILENAME_TITLE = 'منهج-معهد-تعليم-اللغة-العربية-المستوى-الثاني-الاصول-الثلاثة'

describe('displayTitle', () => {
  it('prefers the Arabic title the reader typed over the imported filename', () => {
    expect(
      displayTitle({ title: FILENAME_TITLE, arabicTitle: 'الأصول الثلاثة', language: 'ar' }),
    ).toBe('الأصول الثلاثة')
  })

  it('still prefers the Arabic title before language detection has run', () => {
    // Language is 'unknown' for the whole of the first import, which is exactly
    // when the long filename would otherwise be on screen.
    expect(
      displayTitle({ title: FILENAME_TITLE, arabicTitle: 'الأصول الثلاثة', language: 'unknown' }),
    ).toBe('الأصول الثلاثة')
  })

  it('falls back to the Latin title when there is no Arabic one', () => {
    expect(displayTitle({ title: 'Kitāb at-Tawḥīd', arabicTitle: undefined, language: 'en' })).toBe(
      'Kitāb at-Tawḥīd',
    )
  })

  it('never returns an empty string', () => {
    expect(displayTitle({ title: '', arabicTitle: '', language: 'unknown' })).toBe('Untitled book')
    expect(displayTitle(undefined)).toBe('Untitled book')
  })
})

describe('secondaryTitle', () => {
  it('shows the other name, not a duplicate of the primary', () => {
    const book = { title: FILENAME_TITLE, arabicTitle: 'الأصول الثلاثة', language: 'ar' as const }
    expect(displayTitle(book)).toBe('الأصول الثلاثة')
    expect(secondaryTitle(book)).toBe(FILENAME_TITLE)
  })

  it('returns null when there is only one name', () => {
    expect(secondaryTitle({ title: 'Manhaj as-Sālikīn', arabicTitle: '', language: 'en' })).toBeNull()
  })
})

describe('titleFromFilename', () => {
  it('cleans up the usual download debris', () => {
    expect(titleFromFilename('Usul_ath_Thalathah (1).pdf')).toBe('Usul ath Thalathah')
    expect(titleFromFilename('kitab--at--tawhid.PDF')).toBe('kitab at tawhid')
  })

  it('leaves an already-tidy name alone', () => {
    expect(titleFromFilename('Manhaj as-Salikin.pdf')).toBe('Manhaj as-Salikin')
  })
})
