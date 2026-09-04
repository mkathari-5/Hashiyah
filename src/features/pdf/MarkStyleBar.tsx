import { MARK_COLORS, MARK_SIZES } from '@/services/annotations/PageMarkEngine'
import type { PageMarkStyle, TextAlign, TextDirectionMode } from '@/types'

export function MarkStyleBar({
  style,
  onChange,
}: {
  style: PageMarkStyle
  onChange: (patch: Partial<PageMarkStyle>) => void
}) {
  return (
    <div className="mark-style-bar" role="toolbar" aria-label="Text annotation style" onPointerDown={(e) => e.stopPropagation()}>
      <label className="mark-style-field">
        <span className="sr-only">Font size</span>
        <select
          value={MARK_SIZES.includes(style.fontSize as (typeof MARK_SIZES)[number]) ? String(style.fontSize) : 'custom'}
          onChange={(event) => {
            if (event.target.value !== 'custom') onChange({ fontSize: Number(event.target.value) })
          }}
        >
          {MARK_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
          {!MARK_SIZES.includes(style.fontSize as (typeof MARK_SIZES)[number]) && <option value="custom">Custom</option>}
        </select>
      </label>
      <input
        type="number"
        min={8}
        max={72}
        value={style.fontSize}
        aria-label="Custom font size"
        className="mark-style-size"
        onChange={(event) => {
          const fontSize = Number(event.target.value)
          if (Number.isFinite(fontSize) && fontSize >= 8) onChange({ fontSize })
        }}
      />

      <span className="pdf-annot-sep" />

      {MARK_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          title={color}
          aria-label={`Colour ${color}`}
          aria-pressed={style.color === color}
          className={`mark-swatch${style.color === color ? ' is-active' : ''}`}
          style={{ background: color }}
          onClick={() => onChange({ color, strokeColor: color })}
        />
      ))}
      <label className="mark-style-field" title="Custom colour">
        <span className="sr-only">Custom colour</span>
        <input
          type="color"
          value={style.color}
          onChange={(event) => onChange({ color: event.target.value, strokeColor: event.target.value })}
        />
      </label>

      <span className="pdf-annot-sep" />

      {(['auto', 'rtl', 'ltr'] as TextDirectionMode[]).map((direction) => (
        <button
          key={direction}
          type="button"
          className={`mark-style-chip${style.direction === direction ? ' is-active' : ''}`}
          aria-pressed={style.direction === direction}
          onClick={() => onChange({ direction })}
        >
          {direction === 'auto' ? 'Auto' : direction.toUpperCase()}
        </button>
      ))}

      {(['start', 'center', 'end'] as TextAlign[]).map((align) => (
        <button
          key={align}
          type="button"
          className={`mark-style-chip${style.align === align ? ' is-active' : ''}`}
          aria-pressed={style.align === align}
          title={align}
          onClick={() => onChange({ align })}
        >
          {align === 'start' ? '⇤' : align === 'center' ? '↔' : '⇥'}
        </button>
      ))}
    </div>
  )
}
