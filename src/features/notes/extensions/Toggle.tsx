import { Node, mergeAttributes } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { detectDirection } from '@/lib/dir'

/**
 * Collapsible sections (§25–§39).
 *
 * ── Why this is no longer built on <details> ──────────────────────────────
 *
 * The previous implementation used native `<details>`/`<summary>` and listened
 * for the DOM `toggle` event through ProseMirror's `handleDOMEvents`. That can
 * never work, and the reason is worth recording: **the `toggle` event does not
 * bubble**. ProseMirror attaches those handlers on its root element, so the
 * event fired on a nested `<details>` never reached it. `attrs.open` therefore
 * stayed `true` forever, and the moment any transaction re-rendered the node
 * from its attributes the browser's collapse was overwritten — the section
 * sprang back open.
 *
 * So the state had two owners that could not see each other: the browser owned
 * the disclosure, ProseMirror owned the markup.
 *
 * Now the document is the single owner. `open` is a node attribute, an explicit
 * arrow button is the only thing that changes it, and the rendering follows
 * from the attribute. Collapsing hides the content element rather than
 * unmounting it, because ProseMirror requires its contentDOM to stay in the
 * tree — unmounting it would corrupt position mapping. The content is *inside*
 * the node, so hiding the wrapper hides paragraphs, lists, quotes, images and
 * nested toggles together (§27), which the old version could not guarantee.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggleBlock: {
      insertToggle: (options?: { level?: number }) => ReturnType
      /** Wrap the current block, keeping its text as the toggle's title (§33). */
      wrapInToggle: (options?: { level?: number }) => ReturnType
      /** Open or close every toggle in the document (§37). */
      setAllTogglesOpen: (open: boolean) => ReturnType
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export const ToggleSummary = Node.create({
  name: 'toggleSummary',
  content: 'inline*',
  defining: true,
  selectable: false,

  parseHTML() {
    // `summary` is accepted so notes written by the previous implementation
    // still parse — the schema shape is unchanged, only the markup moved.
    return [{ tag: 'div[data-toggle-summary]' }, { tag: 'summary' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle-summary': '' }), 0]
  },
})

export const ToggleContent = Node.create({
  name: 'toggleContent',
  content: 'block+',
  selectable: false,

  parseHTML() {
    return [{ tag: 'div[data-toggle-content]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle-content': '' }), 0]
  },
})

// ─────────────────────────────────────────────────────────────────────────────

function ToggleView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const open = node.attrs.open !== false
  const level = Number(node.attrs.level ?? 0)

  const setOpen = (next: boolean) => {
    // If we are collapsing while the caret sits inside the content, move it to
    // the end of the title first — leaving a cursor inside hidden content is
    // how editors end up typing into the void.
    if (!next && typeof getPos === 'function') {
      const pos = getPos()
      if (pos !== undefined) {
        const { from } = editor.state.selection
        const start = pos
        const end = pos + node.nodeSize
        if (from > start && from < end) {
          const summaryEnd = start + 1 + node.child(0).nodeSize - 1
          editor.view.dispatch(
            editor.state.tr.setSelection(TextSelection.create(editor.state.doc, summaryEnd)),
          )
        }
      }
    }
    updateAttributes({ open: next })
  }

  return (
    <NodeViewWrapper
      className="toggle"
      data-toggle=""
      data-open={open ? 'true' : 'false'}
      data-level={level || undefined}
      // A node view does not inherit the attributes `renderHTML` would emit,
      // so the block id has to be set explicitly — without it, jumping to a
      // toggle from the outline or a search result finds nothing.
      data-block-id={node.attrs.blockId ?? undefined}
      // Computed here rather than in CSS: a `:has()` rule would also match a
      // nested toggle's Arabic title and flip the wrong arrow.
      data-dir={detectDirection(node.child(0).textContent, 'ltr')}
    >
      <button
        type="button"
        contentEditable={false}
        // §30 — the arrow is the only collapse target. Clicking the title text
        // must place the caret, never fold the section away mid-sentence.
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setOpen(!open)
        }}
        className="toggle-arrow"
        aria-expanded={open}
        aria-label={open ? 'Collapse section' : 'Expand section'}
        title={open ? 'Collapse' : 'Expand'}
      >
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
          <path
            d="M6 4l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <NodeViewContent as="div" className="toggle-inner" />
    </NodeViewWrapper>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export const ToggleBlock = Node.create({
  name: 'toggleBlock',
  group: 'block',
  content: 'toggleSummary toggleContent',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => {
          const explicit = el.getAttribute('data-open')
          if (explicit !== null) return explicit !== 'false'
          // Legacy markup: a bare <details> is closed, <details open> is open.
          if (el.tagName === 'DETAILS') return el.hasAttribute('open')
          return true
        },
        renderHTML: (attrs) => ({ 'data-open': attrs.open === false ? 'false' : 'true' }),
      },
      /** 0 = plain toggle, 1–3 = toggle heading (§32). */
      level: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-level') ?? 0),
        renderHTML: (attrs) => (attrs.level ? { 'data-level': String(attrs.level) } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-toggle]' }, { tag: 'details' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle': '' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView)
  },

  addCommands() {
    return {
      insertToggle:
        ({ level = 0 } = {}) =>
        ({ tr, dispatch, editor }) => {
          const { schema } = editor
          const node = schema.nodes[this.name].create({ open: true, level }, [
            schema.nodes.toggleSummary.create(),
            schema.nodes.toggleContent.create(null, schema.nodes.paragraph.create()),
          ])

          // Replace the (empty) block the slash command was typed in rather
          // than inserting after it and leaving a stray paragraph behind.
          const { $from } = tr.selection
          const inEmptyParagraph =
            $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0
          const from = inEmptyParagraph ? $from.before() : tr.selection.from
          const to = inEmptyParagraph ? $from.after() : tr.selection.to
          tr.replaceWith(from, to, node)

          if (dispatch) {
            // The caret belongs in the title — it is the first thing you write.
            dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(from + 2), 1)).scrollIntoView())
          }
          return true
        },

      wrapInToggle:
        ({ level = 0 } = {}) =>
        ({ tr, dispatch, editor }) => {
          const { schema } = editor
          const { $from } = tr.selection
          const depth = $from.depth
          const block = $from.node(depth)
          if (!block.isTextblock) return false

          const from = $from.before(depth)
          const to = $from.after(depth)

          // The existing text becomes the title; nothing is discarded (§33).
          const node = schema.nodes[this.name].create({ open: true, level }, [
            schema.nodes.toggleSummary.create(null, block.content),
            schema.nodes.toggleContent.create(null, schema.nodes.paragraph.create()),
          ])
          tr.replaceWith(from, to, node)

          if (dispatch) {
            dispatch(
              tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1 + node.child(0).nodeSize + 1), 1)),
            )
          }
          return true
        },

      setAllTogglesOpen:
        (open) =>
        ({ tr, dispatch, state }) => {
          let changed = false
          state.doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs.open !== open) {
              tr.setNodeAttribute(pos, 'open', open)
              changed = true
            }
          })
          if (changed && dispatch) dispatch(tr)
          return changed
        },
    }
  },

  addKeyboardShortcuts() {
    const findToggle = (state: import('@tiptap/pm/state').EditorState) => {
      const { $from } = state.selection
      for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type.name === this.name) {
          return { node: $from.node(depth), pos: $from.before(depth), depth }
        }
      }
      return null
    }

    return {
      /** Enter at the end of the title moves into the body (§31). */
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty || $from.parent.type.name !== 'toggleSummary') return false

        const found = findToggle(editor.state)
        if (!found) return false

        // Typing into a collapsed section would be invisible, so open it first.
        if (found.node.attrs.open === false) {
          editor.commands.command(({ tr, dispatch }) => {
            tr.setNodeAttribute(found.pos, 'open', true)
            if (dispatch) dispatch(tr)
            return true
          })
        }

        const contentStart = found.pos + 1 + found.node.child(0).nodeSize + 1
        return editor.commands.setTextSelection(contentStart)
      },

      /**
       * Backspace at the very start of the body returns to the end of the
       * title, instead of silently merging the first paragraph into it.
       */
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty || $from.parentOffset !== 0) return false
        if ($from.depth < 2) return false
        if ($from.node(-1).type.name !== 'toggleContent') return false
        if ($from.index(-1) !== 0) return false
        if ($from.parent.content.size > 0) return false

        const found = findToggle(editor.state)
        if (!found) return false
        const summaryEnd = found.pos + 1 + found.node.child(0).nodeSize - 1
        return editor.commands.setTextSelection(summaryEnd)
      },

      /** Fold or unfold the toggle the caret is currently inside. */
      'Mod-Alt-t': ({ editor }) => {
        const found = findToggle(editor.state)
        if (!found) return false
        return editor.commands.command(({ tr, dispatch }) => {
          tr.setNodeAttribute(found.pos, 'open', found.node.attrs.open === false)
          if (dispatch) dispatch(tr)
          return true
        })
      },
    }
  },
})
