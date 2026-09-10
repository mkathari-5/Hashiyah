import { useRef, type CSSProperties } from 'react'
import type { LibraryBlock } from '@/types'
import { BookPdfBlock } from '@/features/library/BookPdfBlock'
import { Icon } from '@/features/shell/Icon'
import { RichTitleView } from '@/features/library/RichTitleView'
import { TitleInlineEditor } from '@/features/library/TitleInlineEditor'
import {
  ariaLabelFor,
  isTransientId,
  numberedIndex,
  PAGE_INDENT_REM,
  placeholderFor,
} from '@/features/library/libraryPageModel'
import type { RichInlineDoc } from '@/lib/richTitle'

export function LibraryBlockRow({
  block,
  blocks,
  depth,
  focused,
  focusCaret,
  gutterOn,
  opensWorkspace,
  onHover,
  onFocus,
  onChange,
  onKeyDown,
  onBlurEmpty,
  onToggle,
  onOpenStudy,
  onOpenPage,
  onOpenWorkspace,
  onTodo,
  onInsert,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onAttachBook,
  onRenameBook,
  onReplaceBook,
  onDetachBook,
  onDeleteBook,
  dragging,
  dropTarget,
}: {
  block: LibraryBlock
  blocks: LibraryBlock[]
  depth: number
  focused: boolean
  focusCaret: 'start' | 'end'
  gutterOn: boolean
  opensWorkspace: boolean
  onHover: (id: string | null) => void
  onFocus: (id: string) => void
  onChange: (id: string, content: string, caret: number, rich: RichInlineDoc | null) => void
  onKeyDown: (id: string, event: KeyboardEvent, caret: number, empty: boolean, collapsed: boolean, plain?: string, rich?: RichInlineDoc | null) => boolean
  onBlurEmpty: (id: string) => void
  onToggle: (id: string) => void
  onOpenStudy: (nodeId: string) => void
  onOpenPage: (pageId: string) => void
  onOpenWorkspace: (id: string) => void
  onTodo: (id: string, checked: boolean) => void
  onInsert: (id: string, anchor: HTMLElement) => void
  onContextMenu?: (id: string, event: React.MouseEvent) => void
  onDragStart: (id: string) => void
  onDragOver: (id: string, event: React.DragEvent) => void
  onDrop: (id: string) => void
  onDragEnd: () => void
  onAttachBook: (id: string) => void
  onRenameBook: (id: string, title: string) => void
  onReplaceBook: (id: string, file: File) => void
  onDetachBook: (id: string) => void
  onDeleteBook: (id: string) => void
  dragging: boolean
  dropTarget: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const isToggle = block.type === 'toggle'
  const isTransient = isTransientId(block.id)
  const nestedDraft = isTransient && !!block.parentBlockId
  const placeholder = placeholderFor(block.type, { focused, transient: isTransient })
  const ariaLabel = ariaLabelFor(block.type)

  return (
    <div
      ref={hostRef}
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
        if (target.closest('button, input[type="checkbox"], a, [data-title-editor], .title-pm, .book-pdf-card')) return
        if (block.type === 'study' || block.type === 'page' || block.type === 'divider' || block.type === 'book') return
        if (opensWorkspace) {
          onOpenWorkspace(block.id)
          return
        }
        onFocus(block.id)
      }}
      onContextMenu={(event) => {
        if (!onContextMenu) return
        event.preventDefault()
        event.stopPropagation()
        onContextMenu(block.id, event)
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
        {block.type === 'book' && <Icon name="file" className="page-block-type-icon" />}
      </div>

      {block.type === 'divider' ? (
        <hr className="page-block-rule" />
      ) : block.type === 'book' ? (
        <BookPdfBlock
          block={block}
          onOpen={() => onOpenWorkspace(block.id)}
          onAttach={() => onAttachBook(block.id)}
          onRename={(title) => onRenameBook(block.id, title)}
          onReplace={(file) => onReplaceBook(block.id, file)}
          onDetach={() => onDetachBook(block.id)}
          onDelete={() => onDeleteBook(block.id)}
        />
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
      ) : focused || (isTransient && !opensWorkspace) ? (
        <TitleInlineEditor
          key={block.id}
          id={block.id}
          plain={block.content}
          rich={block.richContent}
          ariaLabel={ariaLabel}
          placeholder={placeholder}
          className={`page-block-input page-block-input-${block.type}`}
          caret={focusCaret}
          autoFocus={focused}
          onFocus={() => onFocus(block.id)}
          onBlur={() => onBlurEmpty(block.id)}
          onChange={(content, rich, caret) => onChange(block.id, content, caret, rich)}
          onKeyDown={(event, caret, empty, collapsed, nextPlain, nextRich) =>
            onKeyDown(block.id, event, caret, empty, collapsed, nextPlain, nextRich)
          }
        />
      ) : (
        <button
          type="button"
          className={`page-block-input page-block-input-${block.type} is-idle`}
          data-plain={block.content}
          data-placeholder={placeholder}
          aria-label={opensWorkspace ? `Open ${block.content || ariaLabel}` : ariaLabel}
          title={block.content || undefined}
          onClick={() => (opensWorkspace ? onOpenWorkspace(block.id) : onFocus(block.id))}
          onDoubleClick={(event) => {
            if (!opensWorkspace) return
            event.preventDefault()
            event.stopPropagation()
            onFocus(block.id)
          }}
          onKeyDown={(event) => {
            if (opensWorkspace && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault()
              onOpenWorkspace(block.id)
              return
            }
            const handled = onKeyDown(
              block.id,
              event.nativeEvent,
              block.content.length,
              !block.content.trim(),
              true,
              block.content,
              block.richContent ?? null,
            )
            if (handled) event.preventDefault()
          }}
        >
          <RichTitleView plain={block.content} rich={block.richContent} />
        </button>
      )}
    </div>
  )
}
