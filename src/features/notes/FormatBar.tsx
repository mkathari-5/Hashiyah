import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { posToDOMRect, type Editor } from '@tiptap/core'
import { filterBlocks, groupBlocks } from '@/features/notes/blockCatalogue'
import type { BlockAlign } from '@/features/notes/extensions/BlockDirection'

/**
 * The floating format toolbar (§11–§14).
 *
 * ── Why the old one kept vanishing ────────────────────────────────────────
 *
 * It gated visibility on `view.hasFocus()`. Pressing any button in the bar
 * moves DOM focus out of the editor for an instant, so the bar unmounted the
 * moment you tried to use it — most visibly on the direction button, which is
 * why "the Arabic button makes the toolbar inaccessible". It also positioned
 * itself at `left: rect.left` with no clamping at all, so in a narrow notes
 * panel half of it rendered outside the window.
 *
 * Both are fixed here:
 *
 *  - Visibility follows the **selection**, not DOM focus. A non-empty selection
 *    keeps the bar up even while focus is inside one of its own menus.
 *  - Position is clamped to the visible panel on both axes, and flips above or
 *    below the selection depending on the room available (§11).
 */

const COLOURS = [
  { label: 'Default', value: null },
  { label: 'Amber', value: 'var(--color-hl-amber)' },
  { label: 'Green', value: 'var(--color-hl-green)' },
  { label: 'Blue', value: 'var(--color-hl-blue)' },
  { label: 'Rose', value: 'var(--color-hl-rose)' },
  { label: 'Violet', value: 'var(--color-hl-violet)' },
]

const ALIGNMENTS: { value: BlockAlign; label: string; glyph: string }[] = [
  { value: 'start', label: 'Align to line start', glyph: '⤺' },
  { value: 'center', label: 'Centre', glyph: '≡' },
  { value: 'end', label: 'Align to line end', glyph: '⤻' },
  { value: 'justify', label: 'Justify', glyph: '☰' },
]

type Panel = null | 'turn' | 'colour' | 'dir' | 'align'

const MARGIN = 8

export function FormatBar({ editor }: { editor: Editor }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [, force] = useState(0)
  const barRef = useRef<HTMLDivElement>(null)

  // Read through a ref so the transaction handler never closes over stale state.
  const panelRef = useRef<Panel>(null)
  panelRef.current = panel

  useEffect(() => {
    const update = () => {
      force((n) => n + 1)
      const { state, view } = editor
      const { from, to, empty } = state.selection

      // A submenu is open: the user is mid-interaction, so hold position even
      // though focus has moved into the menu.
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
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
    }
  }, [editor])

  // Collapse everything when the editor is torn down or the note changes.
  useEffect(() => {
    const reset = () => {
      setPanel(null)
      setAnchor(null)
    }
    editor.on('destroy', reset)
    return () => {
      editor.off('destroy', reset)
    }
  }, [editor])

  /**
   * §11 — clamp into the visible area on both axes and flip vertically when
   * there is not enough room above. Measured after render so the real width is
   * used rather than a guess.
   */
  useLayoutEffect(() => {
    if (!anchor || !barRef.current) {
      setPos(null)
      return
    }
    const bar = barRef.current.getBoundingClientRect()
    const bounds = editor.view.dom.getBoundingClientRect()

    const minLeft = Math.max(MARGIN, bounds.left - 40)
    const maxLeft = Math.min(window.innerWidth - MARGIN, bounds.right + 40) - bar.width
    const wanted = anchor.left + anchor.width / 2 - bar.width / 2
    const left = Math.max(minLeft, Math.min(wanted, Math.max(minLeft, maxLeft)))

    const above = anchor.top - bar.height - 8
    const below = anchor.bottom + 8
    const top = above >= MARGIN ? above : Math.min(below, window.innerHeight - bar.height - MARGIN)

    setPos({ left, top: Math.max(MARGIN, top) })
  }, [anchor, panel, editor])

  useEffect(() => {
    if (!panel) return
    const onDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setPanel(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [panel])

  const run = useCallback(
    (fn: () => void) => {
      fn()
      // Keep the caret where it was so the bar stays anchored to the same text.
      editor.view.focus()
    },
    [editor],
  )

  if (!anchor) return null

  const attrs = editor.getAttributes('paragraph')
  const currentDir = (attrs.dir as string | null) ?? null
  const currentAlign = (attrs.textAlign as BlockAlign | null) ?? null

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
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`grid h-7 min-w-7 shrink-0 place-items-center rounded px-1.5 text-xs ${
        active ? 'bg-hover text-accent' : 'text-ink-muted hover:text-ink hover:bg-hover'
      }`}
    >
      {children}
    </button>
  )

  const Menu = ({ id, label, children }: { id: Panel; label: string; children: React.ReactNode }) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-expanded={panel === id}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setPanel((p) => (p === id ? null : id))}
      className={`flex h-7 shrink-0 items-center gap-1 rounded px-1.5 text-xs ${
        panel === id ? 'bg-hover text-ink' : 'text-ink-muted hover:text-ink hover:bg-hover'
      }`}
    >
      {children}
      <span aria-hidden className="text-[9px] opacity-70">
        ▾
      </span>
    </button>
  )

  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined
    const href = window.prompt('Link URL', previous ?? 'https://')?.trim()
    if (href === undefined) return
    if (!href) run(() => editor.chain().unsetLink().run())
    else run(() => editor.chain().extendMarkRange('link').setLink({ href }).run())
  }

  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-label="Text formatting"
      className="border-line bg-elevated fixed z-50 flex max-w-[min(34rem,calc(100vw-1rem))] flex-wrap items-center gap-0.5 rounded-md border p-1 shadow-lg"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      <Menu id="turn" label="Turn into">
        Style
      </Menu>

      <span className="bg-line mx-0.5 h-5 w-px shrink-0" />

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
      <Btn title="Inline code" active={editor.isActive('code')} onClick={() => run(() => editor.chain().toggleCode().run())}>
        <span className="font-mono text-[10px]">{'<>'}</span>
      </Btn>
      <Btn title="Link  Ctrl+K" active={editor.isActive('link')} onClick={setLink}>
        ⛓
      </Btn>

      <span className="bg-line mx-0.5 h-5 w-px shrink-0" />

      <Menu id="colour" label="Colour and highlight">
        <span className="h-3 w-3 rounded-[3px] border border-current" />
      </Menu>

      {/* §12 — direction and alignment are separate menus, deliberately. */}
      <Menu id="dir" label="Text direction">
        <span className="font-arabic text-[12px] leading-none">{currentDir === 'rtl' ? 'ع' : 'A'}</span>
      </Menu>
      <Menu id="align" label="Text alignment">
        <span aria-hidden>{ALIGNMENTS.find((a) => a.value === currentAlign)?.glyph ?? '⤺'}</span>
      </Menu>

      {panel === 'turn' && (
        <Dropdown side="start">
          {groupBlocks(filterBlocks('').filter((b) => b.turnInto)).map(([group, blocks]) => (
            <div key={group}>
              <div className="block-menu-group">{group}</div>
              {blocks.map((block) => (
                <button
                  key={block.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    run(() => block.run(editor))
                    setPanel(null)
                  }}
                  className="block-menu-item"
                >
                  <span className="block-menu-icon" aria-hidden>
                    {block.icon}
                  </span>
                  <span className="flex-1">{block.title}</span>
                </button>
              ))}
            </div>
          ))}
        </Dropdown>
      )}

      {panel === 'colour' && (
        <Dropdown side="end">
          <div className="block-menu-group">Text</div>
          {COLOURS.map((c) => (
            <button
              key={`t-${c.label}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                run(() => (c.value ? editor.chain().setColor(c.value).run() : editor.chain().unsetColor().run()))
                setPanel(null)
              }}
              className="block-menu-item"
            >
              <span className="block-menu-swatch" style={{ background: c.value ?? 'var(--color-ink)' }} />
              <span className="flex-1">{c.label}</span>
            </button>
          ))}
          <div className="block-menu-sep" />
          <div className="block-menu-group">Highlight</div>
          {COLOURS.map((c) => (
            <button
              key={`h-${c.label}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                run(() =>
                  c.value
                    ? editor.chain().setHighlight({ color: c.value }).run()
                    : editor.chain().unsetHighlight().run(),
                )
                setPanel(null)
              }}
              className="block-menu-item"
            >
              <span
                className="block-menu-swatch"
                style={{
                  background: c.value ?? 'transparent',
                  opacity: c.value ? 0.6 : 1,
                  border: c.value ? 'none' : '1px solid var(--color-line-strong)',
                }}
              />
              <span className="flex-1">{c.label === 'Default' ? 'None' : c.label}</span>
            </button>
          ))}
        </Dropdown>
      )}

      {panel === 'dir' && (
        <Dropdown side="end">
          <div className="block-menu-group">Direction</div>
          {(
            [
              { value: 'ltr' as const, label: 'Left to right', hint: 'A' },
              { value: 'rtl' as const, label: 'Right to left', hint: 'ع' },
              { value: null, label: 'Automatic', hint: '↺' },
            ]
          ).map((option) => (
            <button
              key={option.label}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                run(() => editor.chain().setBlockDirection(option.value).run())
                setPanel(null)
              }}
              className={`block-menu-item ${currentDir === option.value ? 'text-accent' : ''}`}
            >
              <span className="block-menu-icon font-arabic" aria-hidden>
                {option.hint}
              </span>
              <span className="flex-1">{option.label}</span>
            </button>
          ))}
          <p className="text-ink-faint px-2 pt-1 pb-1.5 text-[10.5px] leading-snug">
            Direction is separate from alignment — changing it leaves your alignment alone.
          </p>
        </Dropdown>
      )}

      {panel === 'align' && (
        <Dropdown side="end">
          <div className="block-menu-group">Alignment</div>
          {ALIGNMENTS.map((option) => (
            <button
              key={option.value}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                run(() => editor.chain().setBlockAlign(option.value).run())
                setPanel(null)
              }}
              className={`block-menu-item ${currentAlign === option.value ? 'text-accent' : ''}`}
            >
              <span className="block-menu-icon" aria-hidden>
                {option.glyph}
              </span>
              <span className="flex-1">{option.label}</span>
            </button>
          ))}
          <div className="block-menu-sep" />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              run(() => editor.chain().setBlockAlign(null).run())
              setPanel(null)
            }}
            className="block-menu-item"
          >
            <span className="block-menu-icon" aria-hidden>
              ↺
            </span>
            <span className="flex-1">Default</span>
          </button>
        </Dropdown>
      )}
    </div>
  )
}

/** Anchored to whichever edge keeps it inside the window. */
function Dropdown({ side, children }: { side: 'start' | 'end'; children: React.ReactNode }) {
  return (
    <div
      className={`border-line bg-elevated absolute top-full z-10 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border p-1 shadow-xl ${
        side === 'start' ? 'start-0' : 'end-0'
      }`}
    >
      {children}
    </div>
  )
}
