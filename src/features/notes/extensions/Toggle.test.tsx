import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { noteExtensions } from '@/features/notes/NoteEditor'
import { collectToggleStates } from '@/services/notes/NotesService'

/**
 * The toggle as the reader meets it: a real editor, the real extension set and
 * the real React node view.
 *
 * React node views and the slash portal paint a tick after `setContent` /
 * `insertContent`, so every DOM assertion waits — querying in the same
 * `act()` that mutates the document is how the arrow and menu looked "missing".
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let editor: Editor | null = null

function Host() {
  const instance = useEditor({
    extensions: noteExtensions,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    immediatelyRender: true,
  })
  editor = instance
  return instance ? <EditorContent editor={instance} /> : null
}

function mount() {
  const utils = render(<Host />)
  if (!editor) throw new Error('editor did not mount')
  return { ...utils, editor: editor as Editor }
}

/** Character-by-character, so the suggestion plugin sees every query it would. */
function type(e: Editor, text: string) {
  e.commands.focus()
  for (const char of text) e.commands.insertContent(char)
}

async function pickSlashItem(label: string) {
  const item = await waitFor(() => {
    const items = [...document.querySelectorAll<HTMLElement>('.slash-menu .slash-item')]
    const found = items.find((el) => el.textContent?.replace(/^\W+/, '').startsWith(label))
    if (!found) throw new Error(`no slash item ${label} in [${items.map((i) => i.textContent)}]`)
    return found
  })
  item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
}

async function waitForArrow(container: HTMLElement, index = 0) {
  return waitFor(() => {
    const arrows = [...container.querySelectorAll<HTMLElement>('.toggle-arrow')]
    const arrow = arrows[index]
    if (!arrow) throw new Error(`no toggle-arrow at ${index} (have ${arrows.length})`)
    return arrow
  })
}

const toggleNodes = (e: Editor) => {
  const found: { open: boolean; title: string; body: string }[] = []
  e.state.doc.descendants((node) => {
    if (node.type.name === 'toggleBlock') {
      found.push({
        open: node.attrs.open !== false,
        title: node.child(0).textContent,
        body: node.child(1).textContent,
      })
    }
  })
  return found
}

const toggleJson = (title: string, open = true, body = 'Answer.') => ({
  type: 'toggleBlock',
  attrs: { open, level: 0 },
  content: [
    { type: 'toggleSummary', content: [{ type: 'text', text: title }] },
    {
      type: 'toggleContent',
      content: [body ? { type: 'paragraph', content: [{ type: 'text', text: body }] } : { type: 'paragraph' }],
    },
  ],
})

afterEach(() => {
  editor?.destroy()
  editor = null
  cleanup()
  document.querySelectorAll('.slash-menu').forEach((el) => el.parentElement?.remove())
})

// ─── The slash command ───────────────────────────────────────────────────────

describe('/toggle', () => {
  it('consumes the whole command, slash included', async () => {
    const { editor: e } = mount()
    await act(async () => {
      type(e, '/toggle')
    })
    await act(async () => {
      await pickSlashItem('Toggle')
    })

    expect(e.getText()).not.toContain('/')
    expect(e.getText()).not.toContain('toggle')
    expect(toggleNodes(e)).toHaveLength(1)
  })

  it('consumes a partial query too', async () => {
    const { editor: e } = mount()
    await act(async () => {
      type(e, '/tog')
    })
    await act(async () => {
      await pickSlashItem('Toggle')
    })

    expect(e.getText()).not.toContain('tog')
    expect(toggleNodes(e)).toHaveLength(1)
  })

  it('uses the live slash range after the query grows', async () => {
    const { editor: e } = mount()
    await act(async () => {
      type(e, '/tog')
    })
    await waitFor(() => expect(document.querySelector('.slash-menu .slash-item')).toBeTruthy())
    // Grow the query; the painted menu range used to lag one keystroke behind.
    await act(async () => {
      type(e, 'gle')
    })
    await act(async () => {
      await pickSlashItem('Toggle')
    })

    expect(e.getText().trim()).toBe('')
    expect(toggleNodes(e)).toHaveLength(1)
  })

  it('leaves the caret inside the new title, ready to type', async () => {
    const { editor: e } = mount()
    await act(async () => {
      type(e, '/toggle')
    })
    await act(async () => {
      await pickSlashItem('Toggle')
    })

    expect(e.state.selection.$from.parent.type.name).toBe('toggleSummary')

    await act(async () => {
      type(e, 'What is Tawḥīd?')
    })
    expect(toggleNodes(e)[0].title).toBe('What is Tawḥīd?')
  })

  it('builds a title/body pair, open, with an empty body paragraph', async () => {
    const { editor: e } = mount()
    await act(async () => {
      type(e, '/toggle')
    })
    await act(async () => {
      await pickSlashItem('Toggle')
    })

    const node = e.state.doc.child(0)
    expect(node.type.name).toBe('toggleBlock')
    expect(node.attrs.open).toBe(true)
    expect(node.child(0).type.name).toBe('toggleSummary')
    expect(node.child(1).type.name).toBe('toggleContent')
    expect(node.child(1).child(0).type.name).toBe('paragraph')
  })

  it('inside a toggle body it nests instead of splitting the parent', async () => {
    const { editor: e } = mount()
    await act(async () => {
      e.commands.setContent({ type: 'doc', content: [toggleJson('Parent', true, '')] })
      e.commands.setTextSelection(e.state.doc.child(0).child(0).nodeSize + 3)
      type(e, '/toggle')
    })
    await act(async () => {
      await pickSlashItem('Toggle')
    })

    const nodes = toggleNodes(e)
    expect(nodes).toHaveLength(2)
    expect(nodes[0].title).toBe('Parent')
    expect(e.state.doc.child(0).child(1).child(0).type.name).toBe('toggleBlock')
  })
})

// ─── The arrow ───────────────────────────────────────────────────────────────

describe('the disclosure arrow', () => {
  it('flips the document attribute', async () => {
    const { editor: e, container } = mount()
    await act(async () => {
      e.commands.setContent({ type: 'doc', content: [toggleJson('Q')] })
    })
    const arrow = await waitForArrow(container)

    await act(async () => arrow.click())
    expect(e.state.doc.child(0).attrs.open).toBe(false)
    await act(async () => arrow.click())
    expect(e.state.doc.child(0).attrs.open).toBe(true)
  })

  it('alternates on ten clicks inside a single render cycle', async () => {
    const { editor: e, container } = mount()
    await act(async () => {
      e.commands.setContent({ type: 'doc', content: [toggleJson('Q')] })
    })
    const arrow = await waitForArrow(container)

    const seen: boolean[] = []
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        arrow.click()
        seen.push(e.state.doc.child(0).attrs.open)
      }
    })

    expect(seen).toEqual([false, true, false, true, false, true, false, true, false, true])
  })

  it('collapsing is visual only — the body survives untouched', async () => {
    const { editor: e, container } = mount()
    await act(async () => {
      e.commands.setContent({ type: 'doc', content: [toggleJson('Q', true, 'Tawḥīd is...')] })
    })
    const arrow = await waitForArrow(container)

    for (let i = 0; i < 5; i++) {
      await act(async () => arrow.click())
      expect(toggleNodes(e)[0].body).toBe('Tawḥīd is...')
    }
    await act(async () => arrow.click())
    expect(toggleNodes(e)).toEqual([{ open: true, title: 'Q', body: 'Tawḥīd is...' }])
  })

  it('keeps blocks other than text inside a collapsed section', async () => {
    const { editor: e, container } = mount()
    await act(async () => {
      e.commands.setContent({
        type: 'doc',
        content: [
          {
            type: 'toggleBlock',
            attrs: { open: true, level: 0 },
            content: [
              { type: 'toggleSummary', content: [{ type: 'text', text: 'Evidence' }] },
              {
                type: 'toggleContent',
                content: [
                  { type: 'image', attrs: { assetId: 'a1' } },
                  {
                    type: 'semanticBlock',
                    attrs: { kind: 'benefit' },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fāʾidah' }] }],
                  },
                ],
              },
            ],
          },
        ],
      })
    })
    const arrow = await waitForArrow(container)
    await act(async () => arrow.click())

    const body = e.state.doc.child(0).child(1)
    expect(body.childCount).toBe(2)
    expect(body.child(0).type.name).toBe('image')
    expect(body.child(1).type.name).toBe('semanticBlock')
    expect(e.state.doc.child(0).attrs.open).toBe(false)
  })

  it('does not toggle when the title itself is clicked', async () => {
    const { editor: e, container } = mount()
    await act(async () => {
      e.commands.setContent({ type: 'doc', content: [toggleJson('Q')] })
    })
    const title = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('[data-toggle-summary]')
      if (!el) throw new Error('no summary')
      return el
    })
    await act(async () => title.click())
    expect(e.state.doc.child(0).attrs.open).toBe(true)
  })
})

// ─── State, nesting and persistence ──────────────────────────────────────────

describe('open state', () => {
  it('survives a save/reload round trip', async () => {
    const { editor: e } = mount()
    await act(async () => {
      e.commands.setContent({
        type: 'doc',
        content: [toggleJson('A', true), toggleJson('B', false), toggleJson('C', true)],
      })
    })
    const saved = JSON.parse(JSON.stringify(e.getJSON()))

    await act(async () => {
      e.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
      e.commands.setContent(saved)
    })
    expect(toggleNodes(e).map((t) => t.open)).toEqual([true, false, true])
  })

  it('nested sections keep their own state', async () => {
    const { editor: e, container } = mount()
    await act(async () => {
      e.commands.setContent({
        type: 'doc',
        content: [
          {
            type: 'toggleBlock',
            attrs: { open: true, level: 0 },
            content: [
              { type: 'toggleSummary', content: [{ type: 'text', text: 'Parent' }] },
              { type: 'toggleContent', content: [toggleJson('Child', true, 'Answer')] },
            ],
          },
        ],
      })
    })
    await waitForArrow(container, 1)

    const arrows = () => [...container.querySelectorAll<HTMLElement>('.toggle-arrow')]

    await act(async () => arrows()[1].click()) // close the child
    await act(async () => arrows()[0].click()) // close the parent
    expect(toggleNodes(e).map((t) => t.open)).toEqual([false, false])

    await act(async () => arrows()[0].click()) // reopen the parent
    expect(toggleNodes(e).map((t) => t.open)).toEqual([true, false])

    await act(async () => arrows()[1].click()) // reopen the child
    expect(toggleNodes(e)).toEqual([
      { open: true, title: 'Parent', body: 'ChildAnswer' },
      { open: true, title: 'Child', body: 'Answer' },
    ])
  })

  it('a revision pass does not overwrite what the reader had open', async () => {
    const { editor: e } = mount()
    await act(async () => {
      e.commands.setContent({
        type: 'doc',
        content: [toggleJson('A', true), toggleJson('B', false)],
      })
    })
    const before = collectToggleStates(e.getJSON())

    await act(async () => {
      e.commands.setAllTogglesOpen(false)
    })
    expect(toggleNodes(e).map((t) => t.open)).toEqual([false, false])

    await act(async () => {
      const ids = Object.keys(before)
      e.commands.command(({ tr, state, dispatch }) => {
        let index = 0
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'toggleBlock') return
          tr.setNodeAttribute(pos, 'open', before[ids[index]])
          index += 1
        })
        dispatch?.(tr)
        return true
      })
    })
    expect(toggleNodes(e).map((t) => t.open)).toEqual([true, false])
  })
})

// ─── Title rendering ─────────────────────────────────────────────────────────

describe('the title', () => {
  it('offers a placeholder that is never document text', async () => {
    const { editor: e, container } = mount()
    await act(async () => {
      type(e, '/toggle')
    })
    await act(async () => {
      await pickSlashItem('Toggle')
    })

    const summary = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('[data-toggle-summary]')
      if (!el) throw new Error('no summary')
      return el
    })
    expect(summary.getAttribute('data-placeholder')).toBe('Toggle')
    expect(summary.textContent).toBe('')
    expect(e.state.doc.child(0).child(0).content.size).toBe(0)
    expect(JSON.stringify(e.getJSON())).not.toContain('"Toggle"')

    await act(async () => {
      type(e, 'X')
    })
    await waitFor(() => {
      expect(container.querySelector('[data-toggle-summary]')?.classList.contains('is-empty')).toBe(
        false,
      )
    })
  })

  it('renders an Arabic title right-to-left, with the arrow out of its way', async () => {
    const { editor: e, container } = mount()
    await act(async () => {
      e.commands.setContent({ type: 'doc', content: [toggleJson('ما هو التوحيد؟', true, 'جواب')] })
    })
    const toggle = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('.toggle')
      if (!el) throw new Error('no toggle')
      return el
    })
    expect(toggle.getAttribute('data-dir')).toBe('rtl')
    expect(toggleNodes(e)[0].title).toBe('ما هو التوحيد؟')
  })

  it('keeps a mixed Arabic/English title in the reading direction of its first word', async () => {
    const { editor: e, container } = mount()
    await act(async () => {
      e.commands.setContent({ type: 'doc', content: [toggleJson('What is التوحيد?')] })
    })
    const toggle = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('.toggle')
      if (!el) throw new Error('no toggle')
      return el
    })
    expect(toggle.getAttribute('data-dir')).toBe('ltr')
    expect(toggleNodes(e)[0].title).toBe('What is التوحيد?')
  })
})
