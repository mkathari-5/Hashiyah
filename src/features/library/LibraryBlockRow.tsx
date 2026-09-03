import { useEffect, useRef, type CSSProperties } from 'react'
import type { LibraryBlock } from '@/types'
import { Icon } from '@/features/shell/Icon'
import {
  ariaLabelFor,
  isTransientId,
  numberedIndex,
  PAGE_INDENT_REM,
  placeholderFor,
} from '@/features/library/libraryPageModel'

export function LibraryBlockRow({
  block,
  blocks,
  depth,
  focused,
  focusCaret,
  gutterOn,
  onHover,
  onFocus,
  onChange,
  onKeyDown,
  onBlurEmpty,
  onToggle,
  onOpenStudy,
  onOpenPage,
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
  focusCaret: 'start' | 'end'
  gutterOn: boolean
  onHover: (id: string | null) => void
  onFocus: (id: string) => void
  onChange: (id: string, content: string, caret: number) => void
  onKeyDown: (id: string, event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onBlurEmpty: (id: string) => void
  onToggle: (id: string) => void
  onOpenStudy: (nodeId: string) => void
  onOpenPage: (pageId: string) => void
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
    if (!focused) return
    const el = areaRef.current
    if (!el) return
    const frame = requestAnimationFrame(() => {
      if (!focusedRef.current) return
      const target = areaRef.current
      if (!target) return
      if (document.activeElement === target) return
      target.focus()
      const pos = focusCaret === 'start' ? 0 : target.value.length
      target.setSelectionRange(pos, pos)
    })
    return () => cancelAnimationFrame(frame)
  }, [focused, block.id, focusCaret])

  const isToggle = block.type === 'toggle'
  const isTransient = isTransientId(block.id)
  const nestedDraft = isTransient && !!block.parentBlockId

  const focusEditor = () => {
    onFocus(block.id)
    areaRef.current?.focus()
  }

  return (
    <div
      className={`page-block page-block-${block.type}${focused ? ' is-focused' : ''}${gutterOn ? ' is-gutter-on' : ''}${dropTarget ? ' is-drop' : ''}${dragging ? ' is-dragging' : ''}`}
      data-block-id={block.id}
      data-block-type={block.type}
      data-parent-id={block.parentBlockId ?? ''}
      data-transient={isTransient ? 'true' : 'false'}
      data-depth={depth}
      data-indent={String(depth * PAGE_INDENT_REM)}
      data-testid={nestedDraft ? 'toggle-child-editor' : undefined}
      style={{ ['--indent']: `calc(${depth} * var(--page-indent))` } as CSSProperties}
      onMouseEnter={() => onHover(block.id)}
      onMouseLeave={() => onHover(null)}
      onClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('button, input[type="checkbox"], a, textarea')) return
        if (block.type === 'study' || block.type === 'page' || block.type === 'divider') return
        focusEditor()
      }}
      onDragOver={(event) => onDragOver(block.id, event)}
      onDrop={(event) => {
        event.preventDefault()
        onDrop(block.id)
      }}
    >
      <div className="page-block-gutter" data-testid="block-gutter">
        <button
          type="button"
          className="page-block-plus"
          aria-label="Insert block"
          title="Insert a block"
          tabIndex={gutterOn ? 0 : -1}
          onMouseDown={(event) => event.preventDefault()}
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
          tabIndex={gutterOn ? 0 : -1}
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

      <div className="page-block-marker" data-testid="block-marker">
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
            <Icon name="chevron-right" className={`page-block-caret-icon${block.expanded ? ' is-expanded' : ''}`} />
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
        {block.type === 'page' && <Icon name="file" className="page-block-type-icon" />}
        {block.type === 'study' && <Icon name="book" className="page-block-type-icon" />}
      </div>

      {block.type === 'divider' ? (
        <hr className="page-block-rule" />
      ) : block.type === 'study' ? (
        <button
          type="button"
          className="page-block-study-link"
          onClick={() => block.libraryNodeId && onOpenStudy(block.libraryNodeId)}
        >
          <span className="page-block-study-title">{block.content || 'Study page'}</span>
        </button>
      ) : block.type === 'page' ? (
        <button
          type="button"
          className="page-block-page-link"
          onClick={() => block.targetPageId && onOpenPage(block.targetPageId)}
        >
          <span className="page-block-page-title">{block.content || 'Page'}</span>
        </button>
      ) : (
        <textarea
          ref={areaRef}
          className={`page-block-input page-block-input-${block.type}`}
          rows={1}
          dir="auto"
          value={block.content}
          title={block.content || undefined}
          placeholder={placeholderFor(block.type, { focused, transient: isTransient })}
          aria-label={ariaLabelFor(block.type)}
          spellCheck={false}
          onFocus={() => onFocus(block.id)}
          onClick={() => onFocus(block.id)}
          onBlur={() => onBlurEmpty(block.id)}
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
