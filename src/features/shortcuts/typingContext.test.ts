import { describe, expect, it } from 'vitest'
import { isTypingContext } from './typingContext'

describe('isTypingContext', () => {
  it('treats inputs, textareas and ProseMirror as editors', () => {
    const input = document.createElement('input')
    const area = document.createElement('textarea')
    const pm = document.createElement('div')
    pm.className = 'ProseMirror'
    const nested = document.createElement('span')
    pm.append(nested)
    expect(isTypingContext(input)).toBe(true)
    expect(isTypingContext(area)).toBe(true)
    expect(isTypingContext(nested)).toBe(true)
  })

  it('does not treat the PDF canvas as an editor', () => {
    const canvas = document.createElement('div')
    canvas.className = 'pdf-canvas'
    expect(isTypingContext(canvas)).toBe(false)
  })
})
