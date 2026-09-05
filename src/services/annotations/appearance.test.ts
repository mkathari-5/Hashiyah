import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HIGHLIGHT_HEX,
  DEFAULT_HIGHLIGHT_OPACITY,
  DEFAULT_UNDERLINE_THICKNESS,
  displayHighlightColor,
  effectiveLineRect,
  highlightFill,
  isLegacyAreaHighlight,
  isLegacyTextCard,
  typewriterSurface,
} from './appearance'

describe('annotation appearance', () => {
  it('maps the previous amber highlighter default to yellow', () => {
    expect(displayHighlightColor('highlight', 'amber')).toBe('yellow')
    expect(displayHighlightColor('highlight', 'green')).toBe('green')
    expect(displayHighlightColor('explain', 'amber')).toBe('amber')
  })

  it('maps the previous amber underline default to ink', () => {
    expect(displayHighlightColor('underline', 'amber')).toBe('ink')
    expect(displayHighlightColor('underline', 'blue')).toBe('blue')
  })

  it('keeps yellow highlights translucent so the page text stays readable', () => {
    expect(DEFAULT_HIGHLIGHT_HEX).toBe('#FFEB3B')
    expect(DEFAULT_HIGHLIGHT_OPACITY).toBeGreaterThanOrEqual(0.3)
    expect(DEFAULT_HIGHLIGHT_OPACITY).toBeLessThanOrEqual(0.4)
    expect(highlightFill('yellow')).toContain(String(DEFAULT_HIGHLIGHT_OPACITY))
  })

  it('re-thins legacy freehand underlines and leaves a custom stroke alone', () => {
    const legacy = effectiveLineRect(
      { x: 0.1, y: 0.4, w: 0.5, h: 0.008 },
      { fontSize: 14, color: '#6b5344', direction: 'auto', align: 'start', strokeColor: '#6b5344', strokeWidth: 2 },
    )
    expect(legacy.h).toBeCloseTo(DEFAULT_UNDERLINE_THICKNESS)
    const custom = effectiveLineRect(
      { x: 0.1, y: 0.4, w: 0.5, h: 0.004 },
      { fontSize: 14, color: '#1a1a1a', direction: 'auto', align: 'start', strokeColor: '#1a1a1a', strokeWidth: 3 },
    )
    expect(custom.h).toBeCloseTo(0.004)
  })

  it('paints legacy gold note cards as transparent typewriter text', () => {
    const legacy = {
      fontSize: 15,
      color: '#6b5344',
      direction: 'auto' as const,
      align: 'start' as const,
      fillColor: '#d8a13d',
      fillOpacity: 0.28,
      strokeWidth: 1.5,
    }
    expect(isLegacyTextCard(legacy)).toBe(true)
    expect(isLegacyAreaHighlight(legacy)).toBe(true)
    expect(typewriterSurface(legacy).background).toBe('transparent')
    expect(typewriterSurface(legacy).border).toBe('none')
  })
})
