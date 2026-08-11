import { Node, mergeAttributes } from '@tiptap/core'

/**
 * A source passage together with everything learned about it.
 *
 * This is the node that makes §27–§30 real. Until now a quotation and the
 * explanation under it were merely adjacent — two unrelated blocks that
 * happened to be next to each other. Wrapping them in one node means the
 * relationship is *structural*: it survives reordering, it can be collapsed,
 * moved or exported as a unit, and a future margin mode can ask "what belongs
 * to this passage?" and get an answer from the document itself rather than from
 * a heuristic about vertical position.
 *
 * Backwards compatible by construction: `sourceQuote` remains a member of the
 * `block` group, so notes written before this existed still parse, and
 * `collectQuoteRefs` already walks the tree recursively.
 *
 * Content is `sourceQuote block+` — a group always has its passage first, and
 * always has at least one block of commentary, so there is never an empty
 * group with nothing to say.
 */
export const SourceGroup = Node.create({
  name: 'sourceGroup',
  group: 'block',
  content: 'sourceQuote block+',
  defining: true,
  isolating: false,

  parseHTML() {
    return [{ tag: 'div[data-source-group]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-source-group': '' }), 0]
  },

  addKeyboardShortcuts() {
    return {
      /**
       * Enter on a trailing empty paragraph leaves the group, the same way it
       * leaves a list. Without this there is no keyboard-only way to stop
       * writing about a passage and start a new thought — which would break
       * the "whole lesson without the mouse" requirement.
       */
      Enter: ({ editor }) => {
        const { state } = editor
        const { $from, empty } = state.selection
        if (!empty) return false

        const parent = $from.parent
        if (parent.type.name !== 'paragraph' || parent.content.size > 0) return false
        if ($from.depth < 2) return false

        const grandparent = $from.node(-1)
        if (grandparent.type.name !== this.name) return false
        // Only the *last* child escapes; an empty paragraph in the middle is
        // just an empty paragraph.
        if ($from.index(-1) !== grandparent.childCount - 1) return false

        return editor.chain().liftEmptyBlock().run()
      },

      /** Backspace at the very start of the first commentary block lifts it out. */
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty || $from.parentOffset !== 0 || $from.depth < 2) return false
        if ($from.node(-1).type.name !== this.name) return false
        // index 0 is the sourceQuote itself, so the first commentary block is 1.
        if ($from.index(-1) !== 1) return false
        return editor.commands.lift(this.name)
      },
    }
  },
})
