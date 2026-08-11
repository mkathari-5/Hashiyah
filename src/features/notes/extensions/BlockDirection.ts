import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { detectDirection } from '@/lib/dir'

/**
 * Per-block direction *and* alignment (§12–§17).
 *
 * The important correction over the previous version: **direction and
 * alignment are separate concerns.** Arabic is not "right aligned" — it is
 * right-to-left, and a right-to-left paragraph can perfectly well be centred,
 * or deliberately aligned left. Conflating the two makes it impossible to write
 *
 *     Shaykh Abdulaziz ar-Rajihi explains…      (LTR, aligned right)
 *
 * which is a completely normal thing to want next to an Arabic quotation.
 *
 * So there are two independent attributes:
 *
 *   dir       'ltr' | 'rtl' | null      null = follow auto-detection
 *   textAlign 'start' | 'center' | 'end' | 'justify' | null
 *
 * Each has a companion lock. Auto-detection only ever writes `dir`, and only
 * while `dirLock` is false — the moment the user chooses a direction the
 * detector stops touching that block. Alignment is *never* set automatically,
 * because there is no way to infer intent from the text.
 *
 * `start`/`end` rather than `left`/`right` so that "aligned to the start of the
 * line" keeps meaning the same thing when the direction changes.
 */

const key = new PluginKey('blockDirection')

const DIRECTED_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'taskItem',
  'toggleSummary',
  'tableCell',
  'tableHeader',
]

export type BlockAlign = 'start' | 'center' | 'end' | 'justify'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockDirection: {
      /** null restores automatic detection. */
      setBlockDirection: (dir: 'ltr' | 'rtl' | null) => ReturnType
      /** null restores the default (start) alignment. */
      setBlockAlign: (align: BlockAlign | null) => ReturnType
    }
  }
}

export const BlockDirection = Extension.create({
  name: 'blockDirection',

  addGlobalAttributes() {
    return [
      {
        types: DIRECTED_TYPES,
        attributes: {
          dir: {
            default: null,
            parseHTML: (el) => el.getAttribute('dir'),
            renderHTML: (attrs) => (attrs.dir ? { dir: attrs.dir } : {}),
          },
          dirLock: {
            default: false,
            parseHTML: (el) => el.hasAttribute('data-dir-lock'),
            renderHTML: (attrs) => (attrs.dirLock ? { 'data-dir-lock': '' } : {}),
          },
          textAlign: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-align'),
            renderHTML: (attrs) => (attrs.textAlign ? { 'data-align': attrs.textAlign } : {}),
          },
        },
      },
    ]
  },

  addCommands() {
    /** Applies a patch to every text block touched by the selection. */
    const applyToBlocks =
      (patch: Record<string, unknown>) =>
      ({ state, dispatch }: { state: import('@tiptap/pm/state').EditorState; dispatch?: (tr: unknown) => void }) => {
        const { from, to } = state.selection
        const tr = state.tr
        let changed = false
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isTextblock || !('dir' in node.attrs)) return
          for (const [name, value] of Object.entries(patch)) tr.setNodeAttribute(pos, name, value)
          changed = true
        })
        if (changed && dispatch) dispatch(tr)
        return changed
      }

    return {
      setBlockDirection: (dir) => applyToBlocks({ dir, dirLock: dir !== null }),
      // Alignment is deliberately independent — setting it never touches `dir`.
      setBlockAlign: (align) => applyToBlocks({ textAlign: align }),
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((t) => t.docChanged)) return null

          const tr = newState.tr
          let changed = false

          newState.doc.descendants((node, pos) => {
            if (!node.isTextblock || !('dir' in node.attrs) || node.attrs.dirLock) return
            const text = node.textContent
            // An empty block keeps whatever direction it had, so the caret does
            // not jump sides between pressing Enter and typing the first letter.
            if (!text) return
            const dir = detectDirection(text, 'ltr')
            if (node.attrs.dir !== dir) {
              tr.setNodeAttribute(pos, 'dir', dir)
              changed = true
            }
          })

          return changed ? tr : null
        },
      }),
    ]
  },
})
