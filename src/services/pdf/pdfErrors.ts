/**
 * Turn pdf.js failures into a sentence the reader can act on.
 *
 * Scanned books are not an error — they paint as images. These messages are
 * only for files that genuinely cannot be opened.
 */

export function describePdfOpenError(error: unknown): string {
  const name = errorName(error)
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''

  if (name === 'PasswordException' || /password/i.test(message)) {
    return 'This PDF is encrypted and needs a password. Ḥāshiyah cannot open password-protected files yet.'
  }
  if (name === 'InvalidPDFException' || /invalid pdf/i.test(message) || /corrupt/i.test(message)) {
    return 'This file is not a readable PDF — it may be damaged or truncated. Try re-exporting or re-downloading it.'
  }
  if (name === 'MissingPDFException' || /missing pdf/i.test(message)) {
    return 'The PDF bytes are missing from local storage. Re-import the book to restore the file.'
  }
  if (name === 'UnexpectedResponseException') {
    return 'The PDF could not be loaded from storage. Re-import the book if the problem persists.'
  }
  if (/operation is not supported/i.test(message) || /unsupported/i.test(message)) {
    return 'This PDF uses features the built-in viewer does not support. Try a different export of the same book.'
  }
  if (message.trim()) return message.trim()
  return 'This PDF could not be opened.'
}

function errorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
    return error.name
  }
  return ''
}
