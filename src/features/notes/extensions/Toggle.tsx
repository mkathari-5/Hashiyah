import { Node, mergeAttributes } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { detectDirection } from '@/lib/dir'
import {
  deleteEmptyToggle,
  emptyToggleShell,
  enterFromEmptyBody,
  findToggle,
  insertSiblingToggle,
  nestUnderPreviousToggle,
  outdentToggle,
} from '@/features/notes/extensions/toggleOutline'

/**
 * Collapsible sections (§25–§39).
 *
 * Document owns `open`. The arrow is the only collapse control. Keyboard model:
 * - Enter in a filled title → open + enter body
 * - Shift+Enter → next sibling toggle (rapid questions)
 * - Enter on the empty last body paragraph → next sibling toggle
 * - Tab / Shift+Tab → nest / outdent when safe
 * - Backspace on a fully empty toggle → remove it
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
      data-block-id={node.attrs.blockId ?? undefined}
      data-dir={detectDirection(node.child(0).textContent, 'ltr')}
    >
      <button
        type="button"
        contentEditable={false}
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

export { isEmptyToggle } from '@/features/notes/extensions/toggleOutline'

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
          if (el.tagName === 'DETAILS') return el.hasAttribute('open')
          return true
        },
        renderHTML: (attrs) => ({ 'data-open': attrs.open === false ? 'false' : 'true' }),
      },
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
          const node = emptyToggleShell(schema, level)

          const { $from } = tr.selection
          const inEmptyParagraph =
            $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0
          const from = inEmptyParagraph ? $from.before() : tr.selection.from
          const to = inEmptyParagraph ? $from.after() : tr.selection.to
          tr.replaceWith(from, to, node)

          if (dispatch) {
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
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty) return false

        if ($from.parent.type.name === 'toggleSummary') {
          const found = findToggle(editor.state)
          if (!found) return false

          if (found.node.attrs.open === false) {
            editor.commands.command(({ tr, dispatch }) => {
              tr.setNodeAttribute(found.pos, 'open', true)
              if (dispatch) dispatch(tr)
              return true
            })
          }

          const contentStart = found.pos + 1 + found.node.child(0).nodeSize + 1
          return editor.commands.command(({ tr, dispatch }) => {
            tr.setSelection(TextSelection.near(tr.doc.resolve(contentStart), 1)).scrollIntoView()
            if (dispatch) dispatch(tr)
            return true
          })
        }

        return enterFromEmptyBody(editor.state, editor.view.dispatch.bind(editor.view))
      },

      /** Rapid consecutive toggles without typing `/toggle` again. */
      'Shift-Enter': ({ editor }) => {
        if (!findToggle(editor.state)) return false
        return insertSiblingToggle(editor.state, editor.view.dispatch.bind(editor.view))
      },

      Tab: ({ editor }) => {
        if (!findToggle(editor.state)) return false
        return nestUnderPreviousToggle(editor.state, editor.view.dispatch.bind(editor.view))
      },

      'Shift-Tab': ({ editor }) => {
        if (!findToggle(editor.state)) return false
        return outdentToggle(editor.state, editor.view.dispatch.bind(editor.view))
      },

      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty) return false

        if ($from.parent.type.name === 'toggleSummary' && $from.parentOffset === 0) {
          if (deleteEmptyToggle(editor.state, editor.view.dispatch.bind(editor.view))) return true
        }

        if ($from.parentOffset !== 0) return false
        if ($from.depth < 2) return false
        if ($from.node(-1).type.name !== 'toggleContent') return false
        if ($from.index(-1) !== 0) return false
        if ($from.parent.content.size > 0) return false

        const found = findToggle(editor.state)
        if (!found) return false

        if (deleteEmptyToggle(editor.state, editor.view.dispatch.bind(editor.view))) return true

        const summaryEnd = found.pos + 1 + found.node.child(0).nodeSize - 1
        return editor.commands.setTextSelection(summaryEnd)
      },

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
