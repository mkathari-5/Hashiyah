import { describe, expect, it } from 'vitest'
import {
  MARKUP_DRAG_THRESHOLD,
  isPdfGlyphTarget,
  keepMarkSelection,
  marksReceivePointer,
  markupPointerDownIntent,
  markupPointerUpAction,
  pointerDistance,
  textLayerInteractive,
} from './pdfToolBehavior'

describe('pdfToolBehavior', () => {
  it('lets only select, text and erase hit existing marks', () => {
    expect(marksReceivePointer('select')).toBe(true)
    expect(marksReceivePointer('text')).toBe(true)
    expect(marksReceivePointer('erase')).toBe(true)
    expect(marksReceivePointer('highlight')).toBe(false)
    expect(marksReceivePointer('underline')).toBe(false)
    expect(marksReceivePointer('pan')).toBe(false)
  })

  it('keeps a selected box when switching to Select, Text or Delete', () => {
    expect(keepMarkSelection('select')).toBe(true)
    expect(keepMarkSelection('text')).toBe(true)
    expect(keepMarkSelection('erase')).toBe(true)
    expect(keepMarkSelection('highlight')).toBe(false)
    expect(keepMarkSelection('pan')).toBe(false)
  })

  it('leaves the text layer interactive for select, highlight and underline', () => {
    expect(textLayerInteractive('select')).toBe(true)
    expect(textLayerInteractive('highlight')).toBe(true)
    expect(textLayerInteractive('underline')).toBe(true)
    expect(textLayerInteractive('text')).toBe(false)
    expect(textLayerInteractive('erase')).toBe(false)
  })

  it('starts a text-markup gesture only when the pointer is on a glyph', () => {
    expect(markupPointerDownIntent('highlight', true)).toBe('select-text')
    expect(markupPointerDownIntent('highlight', false)).toBe('draw-area')
    expect(markupPointerDownIntent('underline', true)).toBe('select-text')
    expect(markupPointerDownIntent('underline', false)).toBe('draw-line')
    expect(markupPointerDownIntent('select', true)).toBeNull()
  })

  it('does not fall back from a failed text selection into an area/line draw', () => {
    expect(
      markupPointerUpAction({ intent: 'select-text', hasTextSelection: false, dragDistance: 40 }),
    ).toBe('none')
    expect(
      markupPointerUpAction({ intent: 'select-text', hasTextSelection: true, dragDistance: 2 }),
    ).toBe('apply-text')
    expect(
      markupPointerUpAction({ intent: 'draw-line', hasTextSelection: true, dragDistance: 3 }),
    ).toBe('none')
    expect(
      markupPointerUpAction({
        intent: 'draw-area',
        hasTextSelection: false,
        dragDistance: MARKUP_DRAG_THRESHOLD,
      }),
    ).toBe('commit-draw')
  })

  it('measures pointer travel in screen pixels', () => {
    expect(pointerDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })

  it('treats pdf.js and OCR spans as glyphs, not the empty text layer', () => {
    const layer = document.createElement('div')
    layer.className = 'textLayer'
    const span = document.createElement('span')
    span.dataset.i = '0'
    layer.append(span)
    expect(isPdfGlyphTarget(span)).toBe(true)
    expect(isPdfGlyphTarget(layer)).toBe(false)

    const ocr = document.createElement('div')
    ocr.className = 'textLayer ocr-text-layer'
    const word = document.createElement('span')
    ocr.append(word)
    expect(isPdfGlyphTarget(word)).toBe(true)
  })
})
