import { useEffect, useState } from 'react'
import { ContextMenu } from '@/features/shell/ContextMenu'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_HIGHLIGHT_OPACITY,
  DEFAULT_UNDERLINE_COLOR,
  HIGHLIGHT_COLOR_HEX,
  HIGHLIGHT_SWATCHES,
  UNDERLINE_SWATCHES,
} from '@/services/annotations/appearance'
import { AnnotationEngine } from '@/services/annotations/AnnotationEngine'
import { recordAnnotationUpdated, snapshotAnnotation } from '@/services/annotations/history'
import { deleteAnnotationMark } from '@/features/pdf/annotationActions'
import { useStudyStore } from '@/state/useStudyStore'
import type { HighlightColor } from '@/types'

export interface AnnotationMenuState {
  x: number
  y: number
  annotationId: string
  kind: 'highlight' | 'underline'
}

export function AnnotationMarkupMenu({
  menu,
  color,
  opacity,
  onClose,
}: {
  menu: AnnotationMenuState
  color: HighlightColor
  opacity?: number
  onClose: () => void
}) {
  const [panel, setPanel] = useState<'menu' | 'props'>('menu')

  if (panel === 'menu') {
    return (
      <ContextMenu
        x={menu.x}
        y={menu.y}
        label={menu.kind === 'underline' ? 'Underline' : 'Highlight'}
        onClose={onClose}
        items={[
          {
            id: 'props',
            label: 'Properties',
            keepOpen: true,
            onSelect: () => {
              useStudyStore.getState().setActiveAnnotation(menu.annotationId)
              setPanel('props')
            },
          },
          {
            id: 'colour',
            label: 'Change colour',
            keepOpen: true,
            onSelect: () => setPanel('props'),
          },
          {
            id: 'delete',
            label: 'Delete',
            danger: true,
            onSelect: () => void deleteAnnotationMark(menu.annotationId),
          },
        ]}
      />
    )
  }

  return (
    <MarkupProperties
      x={menu.x}
      y={menu.y}
      kind={menu.kind}
      color={color}
      opacity={opacity}
      annotationId={menu.annotationId}
      onClose={onClose}
    />
  )
}

function MarkupProperties({
  x,
  y,
  kind,
  color,
  opacity,
  annotationId,
  onClose,
}: {
  x: number
  y: number
  kind: 'highlight' | 'underline'
  color: HighlightColor
  opacity?: number
  annotationId: string
  onClose: () => void
}) {
  const swatches = kind === 'underline' ? UNDERLINE_SWATCHES : HIGHLIGHT_SWATCHES
  const currentOpacity = opacity ?? (kind === 'highlight' ? DEFAULT_HIGHLIGHT_OPACITY : 1)

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.annot-props-panel')) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const patch = async (next: { color?: HighlightColor; opacity?: number }) => {
    const before = await snapshotAnnotation(annotationId)
    await AnnotationEngine.update(annotationId, next)
    const after = await snapshotAnnotation(annotationId)
    if (before && after) recordAnnotationUpdated(before, after)
    const study = useStudyStore.getState()
    if (next.color && kind === 'highlight') study.setLastHighlightColor(next.color)
    if (next.color && kind === 'underline') study.setLastUnderlineColor(next.color)
  }

  return (
    <div
      className="annot-props-panel"
      role="dialog"
      aria-label={kind === 'underline' ? 'Underline properties' : 'Highlight properties'}
      style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 160) }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="annot-props-row">
        {swatches.map((value) => (
          <button
            key={value}
            type="button"
            title={value}
            aria-label={value}
            aria-pressed={color === value}
            className={`mark-swatch${color === value ? ' is-active' : ''}`}
            style={{ background: HIGHLIGHT_COLOR_HEX[value] }}
            onClick={() => void patch({ color: value })}
          />
        ))}
      </div>
      {kind === 'highlight' && (
        <>
          <button
            type="button"
            className="annot-props-reset"
            onClick={() => void patch({ color: DEFAULT_HIGHLIGHT_COLOR, opacity: DEFAULT_HIGHLIGHT_OPACITY })}
          >
            Default yellow
          </button>
          <label className="annot-props-opacity">
            Opacity
            <input
              type="range"
              min={0.15}
              max={0.55}
              step={0.05}
              value={currentOpacity}
              onChange={(event) => void patch({ opacity: Number(event.target.value) })}
            />
          </label>
        </>
      )}
      {kind === 'underline' && (
        <button
          type="button"
          className="annot-props-reset"
          onClick={() => void patch({ color: DEFAULT_UNDERLINE_COLOR })}
        >
          Default black
        </button>
      )}
      <button type="button" className="annot-props-done" onClick={onClose}>
        Done
      </button>
    </div>
  )
}
