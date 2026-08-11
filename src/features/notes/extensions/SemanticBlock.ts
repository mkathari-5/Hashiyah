import { Node, mergeAttributes } from '@tiptap/core'

/**
 * The Islamic note types from §22 — one node with a `kind` attribute, not
 * seventeen node types.
 *
 * Adding "Difference of opinion" later is a line in `SEMANTIC_KINDS` plus a CSS
 * rule, never a schema migration on somebody's only copy of their notes. The
 * label is drawn by CSS `::before` from the same table, so the text of the node
 * contains only what the user actually wrote.
 */

export interface SemanticKind {
  kind: string
  label: string
  arabic?: string
  /** Highlight token used for the rule down the inline-start edge. */
  color: 'amber' | 'green' | 'blue' | 'rose' | 'violet' | 'neutral'
  /**
   * A single glyph shown before the label. Text, not an SVG: it renders through
   * CSS `content`, so seventeen block types cost nothing at runtime and the
   * node's own content stays exactly what the user typed.
   */
  icon: string
  /** Slash-command aliases. */
  aliases: string[]
}

export const SEMANTIC_KINDS: SemanticKind[] = [
  { kind: 'teacher', label: 'Teacher explanation', color: 'amber', icon: '▌', aliases: ['teacher', 'ustadh', 'shaykh', 'explanation'] },
  { kind: 'benefit', label: 'Fāʾidah', arabic: 'فائدة', color: 'green', icon: '◆', aliases: ['benefit', 'faidah', 'fawaid'] },
  { kind: 'definition', label: 'Definition', arabic: 'تعريف', color: 'blue', icon: '◇', aliases: ['definition', 'tarif', 'meaning'] },
  { kind: 'evidence', label: 'Evidence', arabic: 'دليل', color: 'violet', icon: '│', aliases: ['evidence', 'dalil', 'proof'] },
  { kind: 'question', label: 'Question', color: 'rose', icon: '?', aliases: ['question', 'ask'] },
  { kind: 'masalah', label: 'Masʾalah', arabic: 'مسألة', color: 'neutral', icon: '§', aliases: ['masalah', 'issue', 'matter'] },
  { kind: 'qaidah', label: 'Qāʿidah', arabic: 'قاعدة', color: 'violet', icon: '⬡', aliases: ['qaidah', 'rule', 'principle'] },
  { kind: 'athar', label: 'Athar', arabic: 'أثر', color: 'blue', icon: '◈', aliases: ['athar', 'narration'] },
  { kind: 'scholar', label: 'Scholar quotation', color: 'violet', icon: '❝', aliases: ['scholar', 'quote', 'shaykh'] },
  { kind: 'important', label: 'Important', color: 'rose', icon: '★', aliases: ['important', 'key'] },
  { kind: 'warning', label: 'Warning', color: 'rose', icon: '⚠', aliases: ['warning', 'caution'] },
  { kind: 'khilaf', label: 'Difference of opinion', arabic: 'خلاف', color: 'neutral', icon: '⇄', aliases: ['khilaf', 'ikhtilaf', 'difference'] },
  { kind: 'research', label: 'Research', color: 'neutral', icon: '⌕', aliases: ['research', 'lookup', 'todo'] },
  { kind: 'reference', label: 'Reference', color: 'neutral', icon: '↗', aliases: ['reference', 'source', 'citation'] },
  { kind: 'personal', label: 'Personal note', color: 'neutral', icon: '•', aliases: ['personal', 'mine'] },
]

export const SEMANTIC_BY_KIND = new Map(SEMANTIC_KINDS.map((k) => [k.kind, k]))

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    semanticBlock: {
      setSemanticBlock: (kind: string) => ReturnType
      toggleSemanticBlock: (kind: string) => ReturnType
    }
  }
}

export const SemanticBlock = Node.create({
  name: 'semanticBlock',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: 'personal',
        parseHTML: (el) => el.getAttribute('data-kind') ?? 'personal',
        renderHTML: (attrs) => ({ 'data-kind': attrs.kind }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-semantic-block]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    // The label is a rendered attribute rather than editable content, so the
    // node's text is only ever what the user actually wrote.
    const meta = SEMANTIC_BY_KIND.get(node.attrs.kind as string)
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-semantic-block': '',
        'data-label': meta?.label ?? String(node.attrs.kind),
        'data-icon': meta?.icon ?? '•',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setSemanticBlock:
        (kind) =>
        ({ commands }) =>
          commands.wrapIn(this.name, { kind }),
      toggleSemanticBlock:
        (kind) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, { kind }),
    }
  },

  addKeyboardShortcuts() {
    return {
      // Backspace at the very start of a semantic block lifts it out rather
      // than deleting the user's text.
      Backspace: ({ editor }) => {
        const { empty, $anchor } = editor.state.selection
        if (!empty || $anchor.parentOffset !== 0) return false
        if ($anchor.depth < 2 || $anchor.node(-1).type.name !== this.name) return false
        if ($anchor.index(-1) !== 0) return false
        return editor.commands.lift(this.name)
      },
    }
  },
})
