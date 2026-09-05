import type { AnnotationKind, HighlightColor, NormalizedRect, PageMarkStyle } from '@/types'

/** Okular-like highlighter: traditional yellow, translucent enough to read through. */
export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = 'yellow'
export const DEFAULT_HIGHLIGHT_HEX = '#FFEB3B'
export const DEFAULT_HIGHLIGHT_OPACITY = 0.35

/** Okular-like underline: near-black hairline in unrotated page space. */
export const DEFAULT_UNDERLINE_COLOR: HighlightColor = 'ink'
export const DEFAULT_UNDERLINE_HEX = '#1a1a1a'
/**
 * Fraction of page height. On an ~800–900 CSS-px page at 100% zoom this is
 * about 0.9–1.1px — a clean line, not a marker stroke.
 */
export const DEFAULT_UNDERLINE_THICKNESS = 0.0012

export const DEFAULT_TEXT_COLOR = '#1a1a1a'

export const LEGACY_AREA_FILL = '#d8a13d'
export const LEGACY_AREA_OPACITY = 0.28
export const LEGACY_TEXT_COLOR = '#6b5344'
export const LEGACY_STROKE_WIDTHS = new Set([1.5, 2])

/** Previous underlineRectForLine default (~0.007) and the 0.008 freehand line. */
export const LEGACY_UNDERLINE_H_MIN = 0.004
export const LEGACY_UNDERLINE_H_MAX = 0.016

export const HIGHLIGHT_COLOR_HEX: Record<HighlightColor, string> = {
  yellow: DEFAULT_HIGHLIGHT_HEX,
  amber: '#c4923a',
  green: '#56916a',
  blue: '#4a7fa8',
  rose: '#b8615f',
  violet: '#7f6aa8',
  neutral: '#8d867b',
  ink: DEFAULT_UNDERLINE_HEX,
}

export const HIGHLIGHT_SWATCHES: HighlightColor[] = [
  'yellow',
  'green',
  'blue',
  'rose',
  'violet',
  'neutral',
]

export const UNDERLINE_SWATCHES: HighlightColor[] = ['ink', 'amber', 'green', 'blue', 'rose', 'violet']

export const UNDERLINE_WIDTHS = [
  { id: 'hairline', label: 'Hairline', thickness: 0.0009 },
  { id: 'thin', label: 'Thin', thickness: DEFAULT_UNDERLINE_THICKNESS },
  { id: 'medium', label: 'Medium', thickness: 0.0024 },
  { id: 'thick', label: 'Thick', thickness: 0.004 },
] as const

export function isLegacyUnderlineHeight(h: number): boolean {
  return h >= LEGACY_UNDERLINE_H_MIN && h <= LEGACY_UNDERLINE_H_MAX
}

/**
 * Old default highlights stored `amber`. Treat that as the previous product
 * default, not a deliberate gold choice, and paint them yellow.
 */
export function displayHighlightColor(kind: AnnotationKind, color: HighlightColor): HighlightColor {
  if (kind === 'highlight' && color === 'amber') return 'yellow'
  if (kind === 'underline' && color === 'amber') return 'ink'
  return color
}

export function highlightFill(color: HighlightColor, opacity = DEFAULT_HIGHLIGHT_OPACITY): string {
  const hex = HIGHLIGHT_COLOR_HEX[color] ?? DEFAULT_HIGHLIGHT_HEX
  return hexToRgba(hex, opacity)
}

export function underlineCssColor(color: HighlightColor): string {
  return HIGHLIGHT_COLOR_HEX[displayHighlightColor('underline', color)] ?? DEFAULT_UNDERLINE_HEX
}

export function isLegacyAreaHighlight(style: PageMarkStyle): boolean {
  const fill = (style.fillColor ?? LEGACY_AREA_FILL).toLowerCase()
  const opacity = style.fillOpacity ?? LEGACY_AREA_OPACITY
  return fill === LEGACY_AREA_FILL && Math.abs(opacity - LEGACY_AREA_OPACITY) < 0.02
}

export function isLegacyLineStroke(style: PageMarkStyle, rect: NormalizedRect): boolean {
  const stroke = (style.strokeColor ?? style.color ?? '').toLowerCase()
  const legacyColor = stroke === LEGACY_TEXT_COLOR || stroke === '' || stroke === '#6b5344'
  const legacyWidth = style.strokeWidth == null || LEGACY_STROKE_WIDTHS.has(style.strokeWidth)
  return legacyColor && legacyWidth && isLegacyUnderlineHeight(rect.h)
}

export function isLegacyTextCard(style: PageMarkStyle): boolean {
  const fill = (style.fillColor ?? LEGACY_AREA_FILL).toLowerCase()
  const opacity = style.fillOpacity ?? LEGACY_AREA_OPACITY
  return fill === LEGACY_AREA_FILL && Math.abs(opacity - LEGACY_AREA_OPACITY) < 0.02
}

export function effectiveLineRect(rect: NormalizedRect, style: PageMarkStyle): NormalizedRect {
  if (!isLegacyLineStroke(style, rect)) return { ...rect }
  const h = DEFAULT_UNDERLINE_THICKNESS
  return {
    x: rect.x,
    y: rect.y + Math.max(0, (rect.h - h) / 2),
    w: rect.w,
    h,
  }
}

export function typewriterSurface(style: PageMarkStyle): {
  background: string
  border: string
  color: string
  boxShadow: string
} {
  if (isLegacyTextCard(style)) {
    return {
      background: 'transparent',
      border: 'none',
      color: style.color === LEGACY_TEXT_COLOR ? DEFAULT_TEXT_COLOR : style.color,
      boxShadow: 'none',
    }
  }
  const opacity = style.fillOpacity ?? 0
  const background =
    opacity > 0.01 ? hexToRgba(style.fillColor ?? '#fffde7', opacity) : 'transparent'
  const border =
    (style.strokeWidth ?? 0) > 0 && style.strokeColor
      ? `${style.strokeWidth}px solid ${style.strokeColor}`
      : 'none'
  return {
    background,
    border,
    color: style.color || DEFAULT_TEXT_COLOR,
    boxShadow: 'none',
  }
}

export function hexToRgba(hex: string, opacity: number): string {
  const raw = hex.replace('#', '')
  if (raw.length !== 6) return hex
  const n = Number.parseInt(raw, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

export function fontCss(style: PageMarkStyle, dir: 'rtl' | 'ltr'): string {
  if (style.fontFamily === 'serif') return 'var(--font-serif), serif'
  if (style.fontFamily === 'sans') return 'var(--font-sans), sans-serif'
  if (style.fontFamily === 'arabic') return 'var(--font-arabic), serif'
  return dir === 'rtl' ? 'var(--font-arabic), serif' : 'var(--font-sans), sans-serif'
}
