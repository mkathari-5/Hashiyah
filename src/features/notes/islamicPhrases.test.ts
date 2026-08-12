import { describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import {
  insertIslamicPhrase,
  ISLAMIC_PHRASES,
  phraseByShortcut,
} from '@/features/notes/islamicPhrases'
import { ToggleBlock, ToggleContent, ToggleSummary } from '@/features/notes/extensions/Toggle'

function editorWith(doc: object) {
  return new Editor({
    extensions: [StarterKit, ToggleSummary, ToggleContent, ToggleBlock],
    content: doc,
  })
}

describe('Islamic honorific phrases', () => {
  it('exposes the four required shortcuts as an extensible table', () => {
    expect(ISLAMIC_PHRASES.map((p) => p.shortcut)).toEqual(['saw', 'azz', 'swt', 'jwa'])
    expect(phraseByShortcut('/azz')?.text).toBe('عز وجل')
    expect(phraseByShortcut('swt')?.text).toBe('سبحانه وتعالى')
  })

  it.each(ISLAMIC_PHRASES)('inserts /$shortcut inline without wrapping a block', (phrase) => {
    const editor = editorWith({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Allah | said' }],
        },
      ],
    })
    let markerPos = 0
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return
      const i = node.text?.indexOf('|') ?? -1
      if (i >= 0) {
        markerPos = pos + i
        return false
      }
    })
    editor.commands.deleteRange({ from: markerPos, to: markerPos + 1 })
    editor.commands.setTextSelection(markerPos)
    expect(insertIslamicPhrase(editor, phrase.text)).toBe(true)
    // No forced spaces — surrounding text is left exactly as the user typed it.
    expect(editor.getText()).toBe(`Allah ${phrase.text} said`)
    expect(editor.state.doc.childCount).toBe(1)
    editor.destroy()
  })

  it('inserts inside a toggle title and body', () => {
    const editor = editorWith({
      type: 'doc',
      content: [
        {
          type: 'toggleBlock',
          attrs: { open: true, level: 0 },
          content: [
            { type: 'toggleSummary', content: [{ type: 'text', text: 'The Prophet ' }] },
            {
              type: 'toggleContent',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Allah ' }] }],
            },
          ],
        },
      ],
    })

    editor.commands.setTextSelection(1 + 1 + 'The Prophet '.length)
    insertIslamicPhrase(editor, 'صلى الله عليه وسلم')
    expect(editor.state.doc.firstChild!.child(0).textContent).toContain('صلى الله عليه وسلم')

    // Body
    const bodyStart =
      1 + editor.state.doc.firstChild!.child(0).nodeSize + 1 + 1
    editor.commands.setTextSelection(bodyStart + 'Allah '.length)
    insertIslamicPhrase(editor, 'عز وجل')
    expect(editor.state.doc.firstChild!.child(1).textContent).toContain('عز وجل')
    editor.destroy()
  })

  it('supports undo after insertion', () => {
    const editor = editorWith({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
    })
    editor.commands.setTextSelection(2)
    insertIslamicPhrase(editor, 'جل وعلا')
    expect(editor.getText()).toContain('جل وعلا')
    editor.commands.undo()
    expect(editor.getText()).toBe('x')
    editor.destroy()
  })

  it('does not force spaces around the phrase', () => {
    const insertContent = vi.fn().mockReturnValue({ run: () => true })
    const editor = {
      chain: () => ({
        focus: () => ({ insertContent }),
      }),
    } as never
    insertIslamicPhrase(editor, 'سبحانه وتعالى')
    expect(insertContent).toHaveBeenCalledWith('سبحانه وتعالى')
  })

  it('keeps mixed Arabic/English surrounding text intact', () => {
    const editor = editorWith({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Chapter 3 — باب ' }],
        },
      ],
    })
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    insertIslamicPhrase(editor, 'عز وجل')
    expect(editor.getText()).toBe('Chapter 3 — باب عز وجل')
    editor.destroy()
  })
})
