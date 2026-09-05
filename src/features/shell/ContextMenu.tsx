import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  id: string
  label: string
  danger?: boolean
  disabled?: boolean
  keepOpen?: boolean
  onSelect: () => void
}

function menuButtons(root: HTMLElement | null): HTMLButtonElement[] {
  return Array.from(root?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])
}

export function ContextMenu({
  x,
  y,
  items,
  label,
  onClose,
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  label: string
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const box = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)),
    })
  }, [x, y, items.length])

  useEffect(() => {
    menuButtons(ref.current)[0]?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      const buttons = menuButtons(ref.current)
      if (!buttons.length) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const index = buttons.findIndex((button) => button === document.activeElement)
        const delta = event.key === 'ArrowDown' ? 1 : -1
        const next = (Math.max(index, 0) + delta + buttons.length) % buttons.length
        buttons[next]?.focus()
      }
      if (event.key === 'Home') {
        event.preventDefault()
        buttons[0]?.focus()
      }
      if (event.key === 'End') {
        event.preventDefault()
        buttons[buttons.length - 1]?.focus()
      }
    }
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [onClose, items.length])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="node-menu"
      style={{ left: pos.left, top: pos.top }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={`block-menu-item${item.danger ? ' is-danger' : ''}`}
          onClick={() => {
            item.onSelect()
            if (!item.keepOpen) onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
