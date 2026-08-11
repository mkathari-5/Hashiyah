import { Node, mergeAttributes } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { db } from '@/db/db'
import { normalizeForSearch } from '@/lib/arabic'
import { displayTitle } from '@/lib/bookTitle'
import { useStudyStore } from '@/state/useStudyStore'
import type { LinkTargetType } from '@/types'

/**
 * `[[` internal links (§42).
 *
 * A link is stored as an inline atom holding a *label* plus an optional
 * resolved target. The label is authoritative: writing `[[Ḥanīfiyyah]]` before
 * any such note exists is a normal way to work, and the link simply lights up
 * once something with that name appears. That is why the node keeps the text
 * rather than only an id — an unresolved link must never lose what it said.
 */

const wikiPluginKey = new PluginKey('wikiLink')

export interface WikiSuggestion {
  label: string
  targetType: LinkTargetType
  targetId: string | null
  hint?: string
}

async function searchTargets(query: string): Promise<WikiSuggestion[]> {
  const q = normalizeForSearch(query)
  const [books, notes] = await Promise.all([db.books.toArray(), db.notes.toArray()])

  const bookHits: WikiSuggestion[] = books
    .filter((b) => !q || normalizeForSearch(`${b.title} ${b.arabicTitle ?? ''}`).includes(q))
    .slice(0, 6)
    .map((b) => ({ label: displayTitle(b), targetType: 'book', targetId: b.id, hint: 'Book' }))

  const noteHits: WikiSuggestion[] = notes
    .filter((n) => !q || normalizeForSearch(n.title).includes(q))
    .slice(0, 8)
    .map((n) => ({ label: n.title, targetType: 'note', targetId: n.id, hint: 'Note' }))

  const trimmed = query.trim()
  const exists = [...bookHits, ...noteHits].some(
    (h) => normalizeForSearch(h.label) === normalizeForSearch(trimmed),
  )
  const create: WikiSuggestion[] =
    trimmed && !exists
      ? [{ label: trimmed, targetType: 'concept', targetId: null, hint: 'New concept' }]
      : []

  return [...noteHits, ...bookHits, ...create]
}

interface ListProps {
  items: WikiSuggestion[]
  command: (item: WikiSuggestion) => void
}

export interface WikiListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

const WikiList = forwardRef<WikiListHandle, ListProps>(({ items, command }, ref) => {
  const [index, setIndex] = useState(0)
  useEffect(() => setIndex(0), [items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false
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

  if (!items.length) {
    return (
      <div className="slash-menu">
        <p className="text-ink-faint px-3 py-3 text-xs">Type a name to link to.</p>
      </div>
    )
  }

  return (
    <div className="slash-menu">
      {items.map((item, i) => (
        <button
          key={`${item.targetType}:${item.targetId ?? item.label}`}
          type="button"
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault()
            command(item)
          }}
          className={`slash-item ${i === index ? 'is-active' : ''}`}
        >
          <span className="slash-icon" aria-hidden>
            {item.targetType === 'book' ? '▤' : item.targetType === 'note' ? '▪' : '＋'}
          </span>
          <span className="flex-1 truncate">{item.label}</span>
          {item.hint && <span className="text-ink-faint text-[11px]">{item.hint}</span>}
        </button>
      ))}
    </div>
  )
})
WikiList.displayName = 'WikiList'

export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-label') ?? el.textContent ?? '',
        renderHTML: (attrs) => ({ 'data-label': attrs.label }),
      },
      targetType: {
        default: 'concept',
        parseHTML: (el) => el.getAttribute('data-target-type') ?? 'concept',
        renderHTML: (attrs) => ({ 'data-target-type': attrs.targetType }),
      },
      targetId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-target-id'),
        renderHTML: (attrs) => (attrs.targetId ? { 'data-target-id': attrs.targetId } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-wiki-link]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-wiki-link': '',
        class: node.attrs.targetId ? 'wiki-link' : 'wiki-link is-unresolved',
      }),
      `${node.attrs.label}`,
    ]
  },

  renderText({ node }) {
    return `[[${node.attrs.label}]]`
  },

  addProseMirrorPlugins() {
    let renderer: ReactRenderer<WikiListHandle, ListProps> | null = null
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
      Suggestion<WikiSuggestion>({
        editor: this.editor,
        // See SlashCommand: each Suggestion instance needs its own plugin key.
        pluginKey: wikiPluginKey,
        char: '[[',
        allowSpaces: true,
        startOfLine: false,
        items: ({ query }) => searchTargets(query) as unknown as WikiSuggestion[],
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: 'wikiLink',
                attrs: { label: props.label, targetType: props.targetType, targetId: props.targetId },
              },
              { type: 'text', text: ' ' },
            ])
            .run()
        },
        render: () => ({
          onStart: (props) => {
            renderer = new ReactRenderer(WikiList, {
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

/** Click handling lives outside the node so the editor stays free of routing. */
export function handleWikiLinkClick(event: MouseEvent): boolean {
  const el = (event.target as HTMLElement | null)?.closest('a[data-wiki-link]')
  if (!(el instanceof HTMLElement)) return false
  const type = el.dataset.targetType
  const id = el.dataset.targetId
  if (!id) return true // Unresolved: swallow the click rather than doing nothing surprising.
  if (type === 'book') void useStudyStore.getState().openBook(id)
  else if (type === 'note') useStudyStore.getState().setActiveNote(id)
  return true
}
