import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextSelection } from '@tiptap/pm/state'
import { ToggleBlock, ToggleContent, ToggleSummary } from '@/features/notes/extensions/Toggle'
import {
  deleteEmptyToggle,
  exitToggleBody,
  findToggle,
  insertSiblingToggle,
  insertToggleAtCaret,
  isEmptyToggle,
  nestUnderPreviousToggle,
  outdentToggle,
  wrapBlockInToggle,
} from '@/features/notes/extensions/toggleOutline'

/** Plain document rendering — no React node view noise in unit tests. */
const TogglePlain = ToggleBlock.extend({
  addNodeView() {
    return null as never
  },
})

function makeEditor(content: object) {
  return new Editor({
    extensions: [
      StarterKit.configure({ hardBreak: false }),
      ToggleSummary,
      ToggleContent,
      TogglePlain,
    ],
    content,
  })
}

const emptyToggle = (title = '') => ({
  type: 'toggleBlock',
  attrs: { open: true, level: 0 },
  content: [
    title
      ? { type: 'toggleSummary', content: [{ type: 'text', text: title }] }
      : { type: 'toggleSummary' },
    { type: 'toggleContent', content: [{ type: 'paragraph' }] },
  ],
})

const toggleCount = (editor: Editor) => {
  let n = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'toggleBlock') n += 1
  })
  return n
}

describe('Toggle Notion-like keyboard flow', () => {
  it('Enter in a filled title enters the body', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [emptyToggle('What is Tawḥīd?')],
    })
    editor.commands.setTextSelection(2)
    const found = findToggle(editor.state)!
    const contentStart = found.pos + 1 + found.node.child(0).nodeSize + 1
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(contentStart), 1)),
    )
    const { $from } = editor.state.selection
    expect($from.parent.type.name).toBe('paragraph')
    expect($from.node(-1).type.name).toBe('toggleContent')
    editor.destroy()
  })

  it('insertSiblingToggle creates the next sibling toggle', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [emptyToggle('What is Tawḥīd?')],
    })
    editor.commands.setTextSelection(2)
    expect(insertSiblingToggle(editor.state, editor.view.dispatch.bind(editor.view))).toBe(true)
    expect(toggleCount(editor)).toBe(2)
    expect(editor.state.doc.child(0).child(0).textContent).toBe('What is Tawḥīd?')
    expect(editor.state.selection.$from.parent.type.name).toBe('toggleSummary')
    editor.destroy()
  })

  it('Enter on the empty last body paragraph leaves the toggle', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [emptyToggle('Q1')],
    })
    const toggle = editor.state.doc.child(0)
    const bodyPos = 1 + toggle.child(0).nodeSize + 1 + 1
    editor.commands.setTextSelection(bodyPos)
    expect(exitToggleBody(editor.state, editor.view.dispatch.bind(editor.view))).toBe(true)
    // Out, not another question: one toggle, and the caret in prose after it.
    expect(toggleCount(editor)).toBe(1)
    const { $from } = editor.state.selection
    expect($from.parent.type.name).toBe('paragraph')
    expect($from.node(-1).type.name).toBe('doc')
    editor.destroy()
  })

  it('exiting a body with several blocks takes the empty line with it', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [
        {
          type: 'toggleBlock',
          attrs: { open: true, level: 0 },
          content: [
            { type: 'toggleSummary', content: [{ type: 'text', text: 'Q' }] },
            {
              type: 'toggleContent',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Answer.' }] },
                { type: 'paragraph' },
              ],
            },
          ],
        },
      ],
    })
    const toggle = editor.state.doc.child(0)
    const body = toggle.child(1)
    const lastPos = 1 + toggle.child(0).nodeSize + 1 + body.child(0).nodeSize + 1
    editor.commands.setTextSelection(lastPos)
    expect(exitToggleBody(editor.state, editor.view.dispatch.bind(editor.view))).toBe(true)
    expect(editor.state.doc.child(0).child(1).childCount).toBe(1)
    expect(editor.state.doc.child(0).child(1).textContent).toBe('Answer.')
    expect(editor.state.doc.childCount).toBe(2)
    editor.destroy()
  })

  it('a nested toggle exits one level, into its parent body', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [
        {
          type: 'toggleBlock',
          attrs: { open: true, level: 0 },
          content: [
            { type: 'toggleSummary', content: [{ type: 'text', text: 'Parent' }] },
            { type: 'toggleContent', content: [emptyToggle('Child')] },
          ],
        },
      ],
    })
    let bodyPos = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'toggleContent' && node.child(0).type.name === 'paragraph') {
        bodyPos = pos + 2
        return false
      }
    })
    editor.commands.setTextSelection(bodyPos)
    expect(exitToggleBody(editor.state, editor.view.dispatch.bind(editor.view))).toBe(true)
    // The new paragraph is a sibling of the child toggle, inside the parent.
    const parentBody = editor.state.doc.child(0).child(1)
    expect(parentBody.childCount).toBe(2)
    expect(parentBody.child(1).type.name).toBe('paragraph')
    expect(toggleCount(editor)).toBe(2)
    editor.destroy()
  })

  it('`/toggle` inside a toggle title never shreds the toggle', () => {
    const editor = makeEditor({ type: 'doc', content: [emptyToggle('Question')] })
    editor.commands.setTextSelection(2)
    expect(insertToggleAtCaret(editor.state, editor.view.dispatch.bind(editor.view), 0)).toBe(true)
    // A sibling, not a document split: the original title is intact.
    expect(toggleCount(editor)).toBe(2)
    expect(editor.state.doc.child(0).child(0).textContent).toBe('Question')
    expect(editor.state.selection.$from.parent.type.name).toBe('toggleSummary')
    editor.destroy()
  })

  it('`/toggle` in an already empty toggle title reuses it', () => {
    const editor = makeEditor({ type: 'doc', content: [emptyToggle('')] })
    editor.commands.setTextSelection(2)
    expect(insertToggleAtCaret(editor.state, editor.view.dispatch.bind(editor.view), 0)).toBe(true)
    expect(toggleCount(editor)).toBe(1)
    editor.destroy()
  })

  it('converting a toggle title again is a no-op, not a nested wrap', () => {
    const editor = makeEditor({ type: 'doc', content: [emptyToggle('Already a title')] })
    editor.commands.setTextSelection(4)
    expect(wrapBlockInToggle(editor.state, editor.view.dispatch.bind(editor.view), 0)).toBe(true)
    expect(toggleCount(editor)).toBe(1)
    expect(editor.state.doc.child(0).child(0).textContent).toBe('Already a title')
    editor.destroy()
  })

  it('insertToggleAtCaret replaces an empty paragraph and lands in the title', () => {
    const editor = makeEditor({ type: 'doc', content: [{ type: 'paragraph' }] })
    editor.commands.setTextSelection(1)
    expect(insertToggleAtCaret(editor.state, editor.view.dispatch.bind(editor.view), 0)).toBe(true)
    expect(editor.state.doc.child(0).type.name).toBe('toggleBlock')
    expect(editor.state.selection.$from.parent.type.name).toBe('toggleSummary')
    editor.destroy()
  })

  it('Tab nests under the previous toggle; Shift+Tab outdents', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [emptyToggle('Parent'), emptyToggle('Child')],
    })
    // Place caret in the second toggle's title.
    let secondPos = 0
    let seen = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'toggleBlock') {
        seen += 1
        if (seen === 2) {
          secondPos = pos + 2
          return false
        }
      }
    })
    editor.commands.setTextSelection(secondPos)
    expect(nestUnderPreviousToggle(editor.state, editor.view.dispatch.bind(editor.view))).toBe(true)
    expect(editor.state.doc.child(0).type.name).toBe('toggleBlock')
    expect(editor.state.doc.child(0).child(1).childCount).toBe(2)

    expect(outdentToggle(editor.state, editor.view.dispatch.bind(editor.view))).toBe(true)
    expect(toggleCount(editor)).toBe(2)
    expect(editor.state.doc.child(0).child(1).childCount).toBe(1)
    editor.destroy()
  })

  it('Backspace removes a fully empty toggle', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [emptyToggle('Keep'), emptyToggle('')],
    })
    let second = 0
    let seen = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'toggleBlock') {
        seen += 1
        if (seen === 2) {
          second = pos + 2
          return false
        }
      }
    })
    editor.commands.setTextSelection(second)
    const empty = findToggle(editor.state)?.node
    expect(empty && isEmptyToggle(empty)).toBe(true)
    expect(deleteEmptyToggle(editor.state, editor.view.dispatch.bind(editor.view))).toBe(true)
    expect(toggleCount(editor)).toBe(1)
    expect(editor.state.doc.child(0).child(0).textContent).toBe('Keep')
    editor.destroy()
  })

  it('does not delete a populated toggle via deleteEmptyToggle', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [emptyToggle('Important')],
    })
    editor.commands.setTextSelection(2)
    expect(deleteEmptyToggle(editor.state, editor.view.dispatch.bind(editor.view))).toBe(false)
    expect(toggleCount(editor)).toBe(1)
    expect(editor.state.doc.child(0).child(0).textContent).toBe('Important')
    editor.destroy()
  })

  it('supports rapid consecutive sibling creation', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [emptyToggle('What is Tawḥīd?')],
    })
    editor.commands.setTextSelection(2)
    for (let i = 0; i < 4; i++) {
      insertSiblingToggle(editor.state, editor.view.dispatch.bind(editor.view))
    }
    expect(toggleCount(editor)).toBe(5)
    editor.destroy()
  })
})
