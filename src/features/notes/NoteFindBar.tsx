import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Extension } from '@tiptap/core'
import { normalize } from '@/lib/arabic'
import { Icon } from '@/features/shell/Icon'

/**
 * Find within the current note (§38).
 *
 * Matching runs in normalised space, so searching `الحنيفية` finds
 * `ٱلْحَنِيفِيَّة` in your own notes exactly as it does in the book. The index
 * map is what lets a normalised hit be painted over the right raw characters.
 */

export const findPluginKey = new PluginKey<DecorationSet>('noteFind')

interface FindState {
  query: string
  current: number
}

let findState: FindState = { query: '', current: 0 }

export const NoteFind = Extension.create({
  name: 'noteFind',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(findPluginKey) as FindState | undefined
            if (!meta && !tr.docChanged) return old
            const state = meta ?? findState
            findState = state
            if (!state.query.trim()) return DecorationSet.empty

            const needle = normalize(state.query).text
            if (!needle) return DecorationSet.empty

            const decorations: Decoration[] = []
            let hit = 0

            tr.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              const norm = normalize(node.text)
              let from = 0
              for (;;) {
                const at = norm.text.indexOf(needle, from)
                if (at === -1) break
                const rawStart = norm.map[at]
                const rawEnd =
                  at + needle.length >= norm.map.length
                    ? node.text.length
                    : norm.map[at + needle.length]
                decorations.push(
                  Decoration.inline(pos + rawStart, pos + rawEnd, {
                    class: `note-find-hit${hit === state.current ? ' is-current' : ''}`,
                  }),
                )
                hit += 1
                from = at + 1
              }
            })

            return DecorationSet.create(tr.doc, decorations)
          },
        },
        props: {
          decorations: (state) => findPluginKey.getState(state),
        },
      }),
    ]
  },
})

function countHits(editor: Editor, query: string): number {
  const needle = normalize(query).text
  if (!needle) return 0
  let total = 0
  editor.state.doc.descendants((node) => {
    if (!node.isText || !node.text) return
    const norm = normalize(node.text).text
    let from = 0
    for (;;) {
      const at = norm.indexOf(needle, from)
      if (at === -1) break
      total += 1
      from = at + 1
    }
  })
  return total
}

export function NoteFindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const total = useMemo(
    () => (query.trim() ? countHits(editor, query) : 0),
    // Recount whenever the query changes; the document is stable while finding.
    [editor, query],
  )

  useEffect(() => {
    editor.view.dispatch(editor.state.tr.setMeta(findPluginKey, { query, current }))
  }, [editor, query, current])

  useEffect(() => {
    return () => {
      editor.view.dispatch(editor.state.tr.setMeta(findPluginKey, { query: '', current: 0 }))
    }
  }, [editor])

  useEffect(() => setCurrent(0), [query])

  const step = (delta: 1 | -1) => {
    if (total === 0) return
    setCurrent((c) => (c + delta + total) % total)
  }

  return (
    <div className="border-line bg-panel flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
      <Icon name="search" className="text-ink-faint h-3.5 w-3.5" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'Enter') {
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
          }
        }}
        placeholder="Find in this note"
        className="text-ink placeholder:text-ink-faint flex-1 bg-transparent text-xs outline-none"
      />
      <span className="text-ink-faint text-[11px] tabular-nums">
        {total === 0 ? (query ? 'none' : '') : `${current + 1} / ${total}`}
      </span>
      <button
        onClick={() => step(-1)}
        aria-label="Previous match"
        className="hover:bg-hover text-ink-muted grid h-6 w-6 place-items-center rounded"
      >
        <Icon name="chevron-up" className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => step(1)}
        aria-label="Next match"
        className="hover:bg-hover text-ink-muted grid h-6 w-6 place-items-center rounded"
      >
        <Icon name="chevron-down" className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onClose}
        aria-label="Close find"
        className="hover:bg-hover text-ink-muted grid h-6 w-6 place-items-center rounded"
      >
        <Icon name="x" className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
