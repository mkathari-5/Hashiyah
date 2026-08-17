import { Extension, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { flushSync } from 'react-dom'
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

    /**
     * Keeps the menu on screen.
     *
     * The measurement has to come from the menu itself rather than its
     * wrapper, and on the first call React has not painted it yet — taking a
     * zero height there is what let the list run off the bottom of the window
     * when the caret was low on the page (§F16).
     */
    const place = (rect: DOMRect | null, retry = true) => {
      if (!container || !rect) return
      const menu = (container.firstElementChild as HTMLElement | null) ?? container
      const box = menu.getBoundingClientRect()
      if (!box.height && retry) {
        requestAnimationFrame(() => place(rect, false))
        return
      }
      const below = rect.bottom + 6
      const top = below + box.height > window.innerHeight - 8 ? rect.top - box.height - 6 : below
      container.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - box.width - 8))}px`
      container.style.top = `${Math.max(8, Math.min(top, window.innerHeight - box.height - 8))}px`
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
        /**
         * Consume the whole `/query`, not the one React last painted.
         *
         * `range` here is captured by the closure the menu was *rendered* with,
         * and Tiptap renders suggestion menus through React's portal registry —
         * an ordinary state update, committed a frame after the document has
         * already moved on. Type `/toggle` quickly and pick before that commit
         * lands and the stale range covers only `/`, leaving `toggle` behind as
         * literal text (§F17). The live plugin state is always the current one.
         */
        command: ({ editor, range, props }) => {
          const live = slashPluginKey.getState(editor.state) as { range?: Range } | undefined
          const wipe = live?.range ?? range
          // One chain: delete the live `/query` range, then run the catalogue
          // command against the post-delete selection so insertToggle sees an
          // empty paragraph rather than racing a second focus().
          editor
            .chain()
            .focus()
            .command(({ tr, dispatch }) => {
              tr.deleteRange(wipe.from, wipe.to)
              if (dispatch) dispatch(tr)
              return true
            })
            .run()
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
            // Paint the filtered list now rather than next frame: the reader
            // clicks what they can see, so a menu one keystroke behind is a
            // menu that runs the wrong block.
            flushSync(() => {
              renderer?.updateProps({ items: props.items, command: props.command })
            })
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
