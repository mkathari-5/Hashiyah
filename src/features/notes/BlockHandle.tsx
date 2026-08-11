import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { BLOCK_CATALOGUE, filterBlocks, groupBlocks } from '@/features/notes/blockCatalogue'

/**
 * The hover grip (§6).
 *
 * Notion-style: nothing is visible until the pointer is near a block, then a
 * single grip appears in the gutter. Clicking opens the block menu; dragging
 * moves the block.
 *
 * Dragging is handed to ProseMirror rather than reimplemented: we select the
 * node and populate `view.dragging`, after which PM's own drop handling and
 * drop cursor do the work — which is what makes dropping *into* lists and
 * source groups behave correctly.
 *
 * The grip sits on the block's inline-start side, so it moves to the right for
 * Arabic blocks instead of colliding with the text.
 */

interface Target {
  pos: number
  top: number
  left: number
  height: number
  rtl: boolean
}

export function BlockHandle({
  editor,
  scrollRef,
}: {
  editor: Editor
  scrollRef: React.RefObject<HTMLElement | null>
}) {
  const [target, setTarget] = useState<Target | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const hideTimer = useRef<number | undefined>(undefined)

  const locate = useCallback(
    (clientX: number, clientY: number) => {
      const view = editor.view
      const container = scrollRef.current
      if (!container || !view.dom.isConnected) return

      const editorBox = (view.dom as HTMLElement).getBoundingClientRect()
      // Probe horizontally inside the editor even when the pointer is out in
      // the gutter, so approaching from the left still finds the block.
      const probeX = Math.min(Math.max(clientX, editorBox.left + 8), editorBox.right - 8)
      const found = view.posAtCoords({ left: probeX, top: clientY })
      if (!found) return

      const $pos = view.state.doc.resolve(found.inside >= 0 ? found.inside : found.pos)
      const depth = $pos.depth === 0 ? 0 : 1
      const pos = depth === 0 ? $pos.pos : $pos.before(1)
      const dom = view.nodeDOM(pos)
      if (!(dom instanceof HTMLElement)) return

      const box = dom.getBoundingClientRect()
      const containerBox = container.getBoundingClientRect()
      const rtl = window.getComputedStyle(dom).direction === 'rtl'

      setTarget({
        pos,
        top: box.top - containerBox.top + container.scrollTop,
        left: rtl
          ? box.right - containerBox.left + container.scrollLeft + 6
          : box.left - containerBox.left + container.scrollLeft - 26,
        height: box.height,
        rtl,
      })
    },
    [editor, scrollRef],
  )

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const onMove = (event: PointerEvent) => {
      if (menuOpen) return
      window.clearTimeout(hideTimer.current)
      locate(event.clientX, event.clientY)
    }
    const onLeave = () => {
      if (menuOpen) return
      hideTimer.current = window.setTimeout(() => setTarget(null), 180)
    }

    container.addEventListener('pointermove', onMove)
    container.addEventListener('pointerleave', onLeave)
    return () => {
      container.removeEventListener('pointermove', onMove)
      container.removeEventListener('pointerleave', onLeave)
      window.clearTimeout(hideTimer.current)
    }
  }, [locate, menuOpen, scrollRef])

  // A changing document invalidates the cached position.
  useEffect(() => {
    const invalidate = () => {
      if (!menuOpen) setTarget(null)
    }
    editor.on('update', invalidate)
    return () => {
      editor.off('update', invalidate)
    }
  }, [editor, menuOpen])

  if (!target) return null

  const selectBlock = () => {
    const { state, view } = editor
    if (target.pos >= state.doc.content.size) return
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, target.pos)))
  }

  return (
    <>
      <button
        type="button"
        aria-label="Block options"
        title="Drag to move · click for options"
        draggable
        onPointerDown={(e) => e.preventDefault()}
        onDragStart={(event) => {
          const { view } = editor
          selectBlock()
          const slice = view.state.selection.content()
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/html', '')
          const dom = view.nodeDOM(target.pos)
          if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 12, 12)
          // Hand over to ProseMirror's own drag machinery.
          view.dragging = { slice, move: true }
        }}
        onDragEnd={() => setTarget(null)}
        onClick={() => {
          selectBlock()
          setMenuOpen(true)
        }}
        className="block-handle"
        style={{ top: target.top + 1, left: target.left }}
      >
        <span aria-hidden>⠿</span>
      </button>

      {menuOpen && (
        <BlockMenu
          editor={editor}
          pos={target.pos}
          anchor={{ top: target.top + 20, left: target.rtl ? target.left - 210 : target.left }}
          onClose={() => {
            setMenuOpen(false)
            setTarget(null)
          }}
        />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

const COLOURS = [
  { label: 'Default', value: null },
  { label: 'Amber', value: 'var(--color-hl-amber)' },
  { label: 'Green', value: 'var(--color-hl-green)' },
  { label: 'Blue', value: 'var(--color-hl-blue)' },
  { label: 'Rose', value: 'var(--color-hl-rose)' },
  { label: 'Violet', value: 'var(--color-hl-violet)' },
]

function BlockMenu({
  editor,
  pos,
  anchor,
  onClose,
}: {
  editor: Editor
  pos: number
  anchor: { top: number; left: number }
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<'root' | 'turn' | 'colour'>('root')
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const node = pos < editor.state.doc.content.size ? editor.state.doc.nodeAt(pos) : null

  const duplicate = () => {
    if (!node) return
    editor
      .chain()
      .focus()
      .insertContentAt(pos + node.nodeSize, node.toJSON())
      .run()
    onClose()
  }

  const move = (direction: -1 | 1) => {
    // ProseMirror's own list/block lifting handles the awkward cases; for
    // top-level blocks a cut-and-reinsert is exact and keeps one undo step.
    const { state } = editor
    const $pos = state.doc.resolve(pos)
    const index = $pos.index()
    const parent = $pos.parent
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= parent.childCount || !node) return

    const tr = state.tr.delete(pos, pos + node.nodeSize)
    let insertAt = pos
    if (direction === -1) {
      insertAt = pos - parent.child(index - 1).nodeSize
    } else {
      insertAt = pos + parent.child(index + 1).nodeSize
    }
    tr.insert(tr.mapping.map(insertAt, -1), node)
    editor.view.dispatch(tr.scrollIntoView())
    onClose()
  }

  const copyLink = async () => {
    const blockId = node?.attrs?.blockId as string | undefined
    if (!blockId) return
    try {
      await navigator.clipboard.writeText(`hashiyah://block/${blockId}`)
      setCopied(true)
      setTimeout(onClose, 700)
    } catch {
      setCopied(false)
    }
  }

  const remove = () => {
    if (!node) return
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
    onClose()
  }

  const Item = ({
    icon,
    label,
    onClick,
    danger,
    trailing,
  }: {
    icon: string
    label: string
    onClick: () => void
    danger?: boolean
    trailing?: string
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`block-menu-item ${danger ? 'is-danger' : ''}`}
    >
      <span className="block-menu-icon" aria-hidden>
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      {trailing && <span className="text-ink-faint text-[11px]">{trailing}</span>}
    </button>
  )

  return (
    <div ref={ref} className="block-menu" style={{ top: anchor.top, left: Math.max(4, anchor.left) }}>
      {view === 'root' && (
        <>
          <Item icon="⇄" label="Turn into" onClick={() => setView('turn')} trailing="›" />
          <Item icon="⧉" label="Duplicate" onClick={duplicate} />
          <Item icon="↑" label="Move up" onClick={() => move(-1)} />
          <Item icon="↓" label="Move down" onClick={() => move(1)} />
          <Item icon="◐" label="Colour" onClick={() => setView('colour')} trailing="›" />
          <Item icon="🔗" label={copied ? 'Link copied' : 'Copy link to block'} onClick={copyLink} />
          <div className="block-menu-sep" />
          <Item icon="🗑" label="Delete" onClick={remove} danger />
        </>
      )}

      {view === 'turn' && (
        <>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Turn into…"
            className="block-menu-search"
          />
          <div className="max-h-64 overflow-y-auto">
            {groupBlocks(filterBlocks(query).filter((b) => b.turnInto)).map(([group, blocks]) => (
              <div key={group}>
                <div className="block-menu-group">{group}</div>
                {blocks.map((block) => (
                  <button
                    key={block.id}
                    type="button"
                    onClick={() => {
                      block.run(editor)
                      onClose()
                    }}
                    className="block-menu-item"
                  >
                    <span className="block-menu-icon" aria-hidden>
                      {block.icon}
                    </span>
                    <span className="flex-1">{block.title}</span>
                    {block.arabic && (
                      <span className="text-ink-faint font-arabic text-[12px]" dir="rtl">
                        {block.arabic}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
            {filterBlocks(query).filter((b) => b.turnInto).length === 0 && (
              <p className="text-ink-faint px-3 py-3 text-xs">Nothing matches.</p>
            )}
          </div>
        </>
      )}

      {view === 'colour' && (
        <>
          <div className="block-menu-group">Text colour</div>
          {COLOURS.map((colour) => (
            <button
              key={colour.label}
              type="button"
              onClick={() => {
                if (colour.value) editor.chain().focus().setColor(colour.value).run()
                else editor.chain().focus().unsetColor().run()
                onClose()
              }}
              className="block-menu-item"
            >
              <span
                className="block-menu-swatch"
                style={{ background: colour.value ?? 'var(--color-ink)' }}
                aria-hidden
              />
              <span className="flex-1">{colour.label}</span>
            </button>
          ))}
          <div className="block-menu-sep" />
          <div className="block-menu-group">Highlight</div>
          {COLOURS.filter((c) => c.value).map((colour) => (
            <button
              key={colour.label}
              type="button"
              onClick={() => {
                editor.chain().focus().setHighlight({ color: colour.value! }).run()
                onClose()
              }}
              className="block-menu-item"
            >
              <span
                className="block-menu-swatch"
                style={{ background: colour.value!, opacity: 0.6 }}
                aria-hidden
              />
              <span className="flex-1">{colour.label}</span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}

export { BLOCK_CATALOGUE }
