import { useEffect, useRef, type CSSProperties } from 'react'
import type { LibraryBlock } from '@/types'
import { Icon } from '@/features/shell/Icon'
import {
  ariaLabelFor,
  numberedIndex,
  placeholderFor,
  TRANSIENT_BLOCK_ID,
} from '@/features/library/libraryPageModel'

export function LibraryBlockRow({
  block,
  blocks,
  depth,
  focused,
  onFocus,
  onChange,
  onKeyDown,
  onToggle,
  onOpenStudy,
  onTodo,
  onInsert,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  dragging,
  dropTarget,
}: {
  block: LibraryBlock
  blocks: LibraryBlock[]
  depth: number
  focused: boolean
  onFocus: (id: string) => void
  onChange: (id: string, content: string, caret: number) => void
  onKeyDown: (id: string, event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onToggle: (id: string) => void
  onOpenStudy: (nodeId: string) => void
  onTodo: (id: string, checked: boolean) => void
  onInsert: (id: string, anchor: HTMLElement) => void
  onDragStart: (id: string) => void
  onDragOver: (id: string, event: React.DragEvent) => void
  onDrop: (id: string) => void
  onDragEnd: () => void
  dragging: boolean
  dropTarget: boolean
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const focusedRef = useRef(focused)
  focusedRef.current = focused

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [block.content, block.type])

  useEffect(() => {
    const el = areaRef.current
    if (!el || !focused) return
    if (document.activeElement === el) return
    el.focus()
    const caret = el.value.length
    el.setSelectionRange(caret, caret)
  }, [focused, block.id])

  const isToggle = block.type === 'toggle'
  const isTransient = block.id === TRANSIENT_BLOCK_ID

  return (
    <div
      className={`page-block page-block-${block.type}${focused ? ' is-focused' : ''}${dropTarget ? ' is-drop' : ''}${dragging ? ' is-dragging' : ''}`}
      data-block-id={block.id}
      data-block-type={block.type}
      data-parent-id={block.parentBlockId ?? ''}
      data-transient={isTransient ? 'true' : 'false'}
      data-depth={depth}
      style={{ ['--indent']: `${depth * 1.5}rem` } as CSSProperties}
      onDragOver={(event) => onDragOver(block.id, event)}
      onDrop={(event) => {
        event.preventDefault()
        onDrop(block.id)
      }}
    >
      <div className="page-block-gutter">
        <button
          type="button"
          className="page-block-plus"
          aria-label="Insert block"
          title="Insert a block"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onInsert(block.id, event.currentTarget)
          }}
        >
          <Icon name="plus" className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="page-block-handle"
          aria-label="Drag to reorder"
          title="Drag to reorder"
          draggable={!isTransient}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', block.id)
            onDragStart(block.id)
          }}
          onDragEnd={onDragEnd}
        >
          <Icon name="grip" className="h-3.5 w-3.5" />
        </button>
      </div>

      {isToggle && (
        <button
          type="button"
          className="page-block-caret"
          aria-label={block.expanded ? 'Collapse' : 'Expand'}
          aria-expanded={block.expanded}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onToggle(block.id)
          }}
        >
          <Icon name="chevron-right" className={`h-3.5 w-3.5 ${block.expanded ? 'rotate-90' : ''}`} />
        </button>
      )}

      {block.type === 'todo' && (
        <input
          type="checkbox"
          className="page-block-check"
          checked={!!block.checked}
          aria-label="Mark to-do"
          onChange={(event) => onTodo(block.id, event.target.checked)}
        />
      )}

      {block.type === 'bullet' && (
        <span className="page-block-bullet" aria-hidden>
          •
        </span>
      )}

      {block.type === 'numbered' && (
        <span className="page-block-number" aria-hidden>
          {numberedIndex(block, blocks)}.
        </span>
      )}

      {block.type === 'divider' ? (
        <hr className="page-block-rule" />
      ) : block.type === 'study' ? (
        <button
          type="button"
          className="page-block-study"
          onClick={() => block.libraryNodeId && onOpenStudy(block.libraryNodeId)}
        >
          <Icon name="book" className="h-4 w-4" />
          <span className="page-block-study-title">{block.content || 'Study page'}</span>
        </button>
      ) : (
        <textarea
          ref={areaRef}
          className={`page-block-input page-block-input-${block.type}`}
          rows={1}
          value={block.content}
          placeholder={placeholderFor(block.type)}
          aria-label={ariaLabelFor(block.type)}
          spellCheck={false}
          onFocus={() => onFocus(block.id)}
          onClick={() => onFocus(block.id)}
          onChange={(event) =>
            onChange(
              block.id,
              event.currentTarget.value,
              event.currentTarget.selectionStart ?? event.currentTarget.value.length,
            )
          }
          onKeyDown={(event) => onKeyDown(block.id, event)}
        />
      )}
    </div>
  )
}
