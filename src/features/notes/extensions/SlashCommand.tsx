import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { filterBlocks, groupBlocks, type BlockDef } from '@/features/notes/blockCatalogue'
import { useStudyStore } from '@/state/useStudyStore'

/**
 * `/` commands (§7).
 *
 * Reads the shared block catalogue, so this menu and the block menu's "Turn
 * into" can never disagree. Ranked matching means `/ben` highlights Fāʾidah
 * immediately rather than burying it.
 *
 * Everything listed does something. There is no disabled entry and no
 * coming-soon row.
 */

const slashPluginKey = new PluginKey('slashCommand')

export interface ListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface ListProps {
  items: BlockDef[]
  command: (item: BlockDef) => void
}

const SlashList = forwardRef<ListHandle, ListProps>(({ items, command }, ref) => {
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setIndex(0), [items])

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [index])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false
      if (event.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % items.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        setIndex((i) => (i - 1 + items.length) % items.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        command(items[index])
        return true
      }
      return false
    },
  }))

  const grouped = useMemo(() => groupBlocks(items), [items])

  if (!items.length) {
    return (
      <div className="slash-menu">
        <p className="text-ink-faint px-3 py-3 text-xs">No matching block.</p>
      </div>
    )
  }

  let running = -1

  return (
    <div className="slash-menu" ref={listRef}>
      {grouped.map(([group, blocks]) => (
        <div key={group}>
          <div className="slash-group">{group}</div>
          {blocks.map((block) => {
            running += 1
            const active = running === index
            const position = running
            return (
              <button
                key={block.id}
                type="button"
                data-index={position}
                onMouseEnter={() => setIndex(position)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  command(block)
                }}
                className={`slash-item ${active ? 'is-active' : ''}`}
              >
                <span className="slash-icon" aria-hidden>
                  {block.icon}
                </span>
                <span className="flex-1 truncate">{block.title}</span>
                {block.arabic && (
                  <span className="text-ink-faint font-arabic text-[12.5px]" dir="rtl">
                    {block.arabic}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
})
SlashList.displayName = 'SlashList'

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    let renderer: ReactRenderer<ListHandle, ListProps> | null = null
    let container: HTMLElement | null = null

    const place = (rect: DOMRect | null) => {
      if (!container || !rect) return
      const box = container.getBoundingClientRect()
      const below = rect.bottom + 6
      const top = below + box.height > window.innerHeight - 8 ? rect.top - box.height - 6 : below
      container.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - box.width - 8))}px`
      container.style.top = `${Math.max(8, top)}px`
    }

    return [
      Suggestion<BlockDef>({
        editor: this.editor,
        // Distinct key: `[[` links register a second Suggestion plugin, and
        // ProseMirror refuses two plugins sharing the default `suggestion` key.
        pluginKey: slashPluginKey,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) =>
          filterBlocks(query, { hasPdfSelection: !!useStudyStore.getState().selection }),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run()
          props.run(editor)
        },
        render: () => ({
          onStart: (props) => {
            renderer = new ReactRenderer(SlashList, {
              editor: props.editor,
              props: { items: props.items, command: props.command },
            })
            container = document.createElement('div')
            container.style.position = 'fixed'
            container.style.zIndex = '60'
            container.appendChild(renderer.element)
            document.body.appendChild(container)
            place(props.clientRect?.() ?? null)
          },
          onUpdate: (props) => {
            renderer?.updateProps({ items: props.items, command: props.command })
            place(props.clientRect?.() ?? null)
          },
          onKeyDown: (props) => {
            if (props.event.key === 'Escape') return true
            return renderer?.ref?.onKeyDown(props) ?? false
          },
          onExit: () => {
            renderer?.destroy()
            container?.remove()
            renderer = null
            container = null
          },
        }),
      }),
    ]
  },
})
