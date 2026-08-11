import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { newBlockId } from '@/db/repos/notes'

/**
 * Gives every structural block a stable identity.
 *
 * This is the groundwork for "copy link to block" (§41), block bookmarks (§40)
 * and the source-group relationships (§30): all of them need to name a specific
 * paragraph and still find it after the document around it has been rewritten.
 *
 * Ids are assigned lazily by an appendTransaction rather than at creation time,
 * which means existing notes written before this extension existed pick up ids
 * the first time they are opened — no migration, no rewrite of stored data.
 *
 * Duplicated ids (the result of copy/paste, or duplicating a block) are
 * regenerated rather than left to collide.
 */

const key = new PluginKey('blockId')

/**
 * `sourceQuote` is deliberately absent: it declares its own `blockId`
 * attribute, which the quoteRefs index depends on. The plugin below still fills
 * that one in when missing, because it looks at the attribute, not the type.
 */
const ID_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
  'taskList',
  'horizontalRule',
  'semanticBlock',
  'toggleBlock',
  'sourceGroup',
  'quranBlock',
  'hadithBlock',
  'table',
  'image',
]

export const BlockId = Extension.create({
  name: 'blockId',

  addGlobalAttributes() {
    return [
      {
        types: ID_TYPES,
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute('data-block-id'),
            renderHTML: (attrs) => (attrs.blockId ? { 'data-block-id': attrs.blockId } : {}),
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((t) => t.docChanged)) return null

          const tr = newState.tr
          const seen = new Set<string>()
          let changed = false

          newState.doc.descendants((node, pos) => {
            if (!('blockId' in node.attrs)) return
            const current = node.attrs.blockId as string | null
            if (current && !seen.has(current)) {
              seen.add(current)
              return
            }
            const fresh = newBlockId()
            seen.add(fresh)
            tr.setNodeAttribute(pos, 'blockId', fresh)
            changed = true
          })

          return changed ? tr.setMeta('addToHistory', false) : null
        },
      }),
    ]
  },
})
