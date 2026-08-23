import { useEffect, useRef } from 'react'
import type { BlockDef } from '@/features/library/libraryPageModel'

/**
 * Slash / insert menu for the Library page editor.
 *
 * Converts or inserts a supported block type. There are no placeholder AI,
 * embed or HTML entries — only types the editor actually implements.
 */

export function SlashCommandMenu({
  items,
  activeIndex,
  onHover,
  onSelect,
  onClose,
  style,
}: {
  items: BlockDef[]
  activeIndex: number
  onHover: (index: number) => void
  onSelect: (item: BlockDef) => void
  onClose: () => void
  style?: React.CSSProperties
}) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`)
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      (el as HTMLElement).scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  return (
    <div
      ref={listRef}
      className="slash-menu page-slash-menu"
      role="listbox"
      data-testid="slash-menu"
      aria-label="Block types"
      style={style}
    >
      {items.length === 0 ? (
        <p className="text-ink-faint px-3 py-3 text-xs">No matching block.</p>
      ) : (
        items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            data-index={index}
            data-block-type={item.id}
            aria-selected={index === activeIndex}
            className={`slash-item ${index === activeIndex ? 'is-active' : ''}`}
            onMouseEnter={() => onHover(index)}
            onMouseDown={(event) => {
              event.preventDefault()
              onSelect(item)
            }}
          >
            <span className="slash-icon" aria-hidden>
              {item.icon}
            </span>
            <span className="flex-1 truncate">{item.title}</span>
          </button>
        ))
      )}
    </div>
  )
}
