import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { posToDOMRect } from '@tiptap/core'
import { FORMAT_HIGHLIGHT_COLORS, FORMAT_TEXT_COLORS } from '@/features/editor/formatColors'

type Panel = null | 'color' | 'highlight'

export function TitleFormatBar({ editor }: { editor: Editor }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [, force] = useState(0)
  const barRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<Panel>(null)
  panelRef.current = panel

  useEffect(() => {
    const update = () => {
      force((n) => n + 1)
      const { state, view } = editor
      const { from, to, empty } = state.selection
      if (panelRef.current) return
      if (empty || !view.editable) {
        setAnchor(null)
        return
      }
      const box = posToDOMRect(view, from, to)
      if (box.width === 0 && box.height === 0) {
        setAnchor(null)
        return
      }
      setAnchor(box)
    }
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    update()
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
    }
  }, [editor])

  useLayoutEffect(() => {
    if (!anchor || !barRef.current) {
      setPos(null)
      return
    }
    const bar = barRef.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - bar.width / 2, window.innerWidth - bar.width - 8))
    const above = anchor.top - bar.height - 8
    const top = above >= 8 ? above : Math.min(anchor.bottom + 8, window.innerHeight - bar.height - 8)
    setPos({ left, top })
  }, [anchor, panel])

  useEffect(() => {
    if (!panel) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panel])

  if (!anchor && !panel) return null

  const run = (fn: () => void) => {
    fn()
    editor.view.focus()
  }

  const Btn = ({
    active,
    onClick,
    title,
    children,
  }: {
    active?: boolean
    onClick: () => void
    title: string
    children: React.ReactNode
  }) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={!!active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`title-format-btn${active ? ' is-active' : ''}`}
    >
      {children}
    </button>
  )

  return createPortal(
    <div
      ref={barRef}
      role="toolbar"
      aria-label="Title formatting"
      className="title-format-bar"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      <Btn title="Bold  Ctrl+B" active={editor.isActive('bold')} onClick={() => run(() => editor.chain().toggleBold().run())}>
        <span className="font-semibold">B</span>
      </Btn>
      <Btn title="Italic  Ctrl+I" active={editor.isActive('italic')} onClick={() => run(() => editor.chain().toggleItalic().run())}>
        <span className="italic">I</span>
      </Btn>
      <Btn title="Underline  Ctrl+U" active={editor.isActive('underline')} onClick={() => run(() => editor.chain().toggleUnderline().run())}>
        <span className="underline">U</span>
      </Btn>
      <Btn title="Strikethrough" active={editor.isActive('strike')} onClick={() => run(() => editor.chain().toggleStrike().run())}>
        <span className="line-through">S</span>
      </Btn>
      <Btn
        title="Text colour"
        active={panel === 'color' || editor.isActive('textStyle')}
        onClick={() => setPanel((p) => (p === 'color' ? null : 'color'))}
      >
        A
      </Btn>
      <Btn title="Highlight colour" active={panel === 'highlight' || editor.isActive('highlight')} onClick={() => setPanel((p) => (p === 'highlight' ? null : 'highlight'))}>
        ▮
      </Btn>
      <Btn
        title="Clear formatting"
        onClick={() =>
          run(() =>
            editor.chain().unsetAllMarks().unsetHighlight().unsetColor().run(),
          )
        }
      >
        ⌧
      </Btn>

      {panel === 'color' && (
        <div className="title-format-menu" role="menu" aria-label="Text colour">
          {FORMAT_TEXT_COLORS.map((color) => (
            <button
              key={color.label}
              type="button"
              role="menuitem"
              className="block-menu-item"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                run(() =>
                  color.value ? editor.chain().setColor(color.value).run() : editor.chain().unsetColor().run(),
                )
                setPanel(null)
              }}
            >
              <span className="block-menu-swatch" style={{ background: color.value ?? 'var(--color-ink)' }} />
              {color.label}
            </button>
          ))}
        </div>
      )}
      {panel === 'highlight' && (
        <div className="title-format-menu" role="menu" aria-label="Highlight colour">
          {FORMAT_HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color.label}
              type="button"
              role="menuitem"
              className="block-menu-item"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                run(() =>
                  color.value
                    ? editor.chain().setHighlight({ color: color.value }).run()
                    : editor.chain().unsetHighlight().run(),
                )
                setPanel(null)
              }}
            >
              <span
                className="block-menu-swatch"
                style={{ background: color.value ?? 'transparent', border: '1px solid var(--color-line-strong)' }}
              />
              {color.label}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}
