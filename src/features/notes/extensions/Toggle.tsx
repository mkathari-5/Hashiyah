import { Node, mergeAttributes, type Editor } from '@tiptap/core'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { detectDirection } from '@/lib/dir'
import {
  deleteEmptyToggle,
  exitToggleBody,
  findToggle,
  insertSiblingToggle,
  insertToggleAtCaret,
  nestUnderPreviousToggle,
  outdentToggle,
  wrapBlockInToggle,
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

function ToggleView({ node, editor, getPos }: NodeViewProps) {
  const open = node.attrs.open !== false
  const level = Number(node.attrs.level ?? 0)

  /**
   * The document is the single source of truth, read at click time.
   *
   * `node` is a React prop, and Tiptap delivers a changed node by re-rendering
   * through React's portal registry — which commits a frame later. Deriving the
   * next state from the prop meant two clicks inside one render cycle both
   * computed `!open` from the *same* stale value, so the second did nothing and
   * the arrow felt stuck. Reading `doc.nodeAt(pos)` cannot go stale, and one
   * transaction carries both the new state and the caret.
   */
  const toggleOpen = () => {
    if (typeof getPos !== 'function') return
    const pos = getPos()
    if (pos === undefined) return

    const { state } = editor
    const current = state.doc.nodeAt(pos)
    if (!current || current.type.name !== 'toggleBlock') return

    const next = current.attrs.open === false
    let tr = state.tr.setNodeAttribute(pos, 'open', next)

    // Collapsing is visual only — the body stays in the document — so the one
    // thing to move is a caret that would otherwise be left inside hidden text.
    const bodyStart = pos + 1 + current.child(0).nodeSize
    const { from } = state.selection
    if (!next && from > bodyStart && from < pos + current.nodeSize) {
      tr = tr.setSelection(TextSelection.create(tr.doc, bodyStart - 1))
    }

    editor.view.dispatch(tr)
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
          toggleOpen()
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
    return ReactNodeViewRenderer(ToggleView, {
      // Clicks on the disclosure control must not be interpreted as editor
      // selection changes — otherwise ProseMirror can swallow the gesture
      // before our handler flips `open`.
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement | null
        return !!target?.closest?.('.toggle-arrow')
      },
    })
  },

  addCommands() {
    return {
      // `state.tr` inside a command is the *chained* transaction, so these
      // helpers compose with `.focus()` and with the slash command's own
      // `deleteRange` instead of racing them with a second dispatch.
      insertToggle:
        ({ level = 0 } = {}) =>
        ({ state, dispatch }) =>
          insertToggleAtCaret(state, dispatch, level),

      wrapInToggle:
        ({ level = 0 } = {}) =>
        ({ state, dispatch }) =>
          wrapBlockInToggle(state, dispatch, level),

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
    /** Run an outline operation through the command layer, never a raw dispatch. */
    const run =
      (op: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean) =>
      ({ editor }: { editor: Editor }) =>
        editor.commands.command(({ state, dispatch }) => op(state, dispatch))

    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty) return false

        if ($from.parent.type.name === 'toggleSummary') {
          return editor.commands.command(({ state, tr, dispatch }) => {
            const found = findToggle(state)
            if (!found) return false
            // Enter in a title always opens the section it is about to write in.
            tr.setNodeAttribute(found.pos, 'open', true)
            const contentStart = found.pos + 1 + found.node.child(0).nodeSize + 1
            tr.setSelection(TextSelection.near(tr.doc.resolve(contentStart), 1)).scrollIntoView()
            if (dispatch) dispatch(tr)
            return true
          })
        }

        return run(exitToggleBody)({ editor })
      },

      /** Rapid consecutive toggles without typing `/toggle` again. */
      'Shift-Enter': ({ editor }) => {
        if (!findToggle(editor.state)) return false
        return run(insertSiblingToggle)({ editor })
      },

      Tab: ({ editor }) => {
        if (!findToggle(editor.state)) return false
        return run(nestUnderPreviousToggle)({ editor })
      },

      'Shift-Tab': ({ editor }) => {
        if (!findToggle(editor.state)) return false
        return run(outdentToggle)({ editor })
      },

      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty) return false

        // An empty toggle is disposable; a populated one never is, which is
        // what `deleteEmptyToggle` checks before removing anything.
        if ($from.parent.type.name === 'toggleSummary' && $from.parentOffset === 0) {
          if (run(deleteEmptyToggle)({ editor })) return true
          // Otherwise refuse: the default join would pull the title out of the
          // toggle and strand its body.
          return true
        }

        if ($from.parentOffset !== 0) return false
        if ($from.depth < 2) return false
        if ($from.node(-1).type.name !== 'toggleContent') return false
        if ($from.index(-1) !== 0) return false
        if ($from.parent.content.size > 0) return false

        const found = findToggle(editor.state)
        if (!found) return false

        if (run(deleteEmptyToggle)({ editor })) return true

        // Backspace at the top of a populated body puts the caret in the title
        // rather than merging the body into it.
        const summaryEnd = found.pos + 1 + found.node.child(0).nodeSize - 1
        return editor.commands.setTextSelection(summaryEnd)
      },

      'Mod-Alt-t': ({ editor }) =>
        editor.commands.command(({ state, tr, dispatch }) => {
          const found = findToggle(state)
          if (!found) return false
          tr.setNodeAttribute(found.pos, 'open', found.node.attrs.open === false)
          if (dispatch) dispatch(tr)
          return true
        }),
    }
  },
})
