import { describe, expect, it } from 'vitest'
import { describePdfOpenError } from './pdfErrors'

describe('describePdfOpenError', () => {
  it('names an encrypted file', () => {
    const error = Object.assign(new Error('No password given'), { name: 'PasswordException' })
    expect(describePdfOpenError(error)).toMatch(/encrypted|password/i)
  })

  it('names a corrupt file', () => {
    const error = Object.assign(new Error('Invalid PDF structure'), { name: 'InvalidPDFException' })
    expect(describePdfOpenError(error)).toMatch(/damaged|truncated|not a readable PDF/i)
  })

  it('names missing bytes', () => {
    const error = Object.assign(new Error('Missing PDF'), { name: 'MissingPDFException' })
    expect(describePdfOpenError(error)).toMatch(/missing/i)
  })

  it('does not use a generic scanned-page failure', () => {
    expect(describePdfOpenError(new Error('Unexpected token'))).not.toBe('Cannot read PDF')
  })
})
