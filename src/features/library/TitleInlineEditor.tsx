import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import { Placeholder } from '@tiptap/extensions'
import { TitleFormatBar } from '@/features/library/TitleFormatBar'
import { Underline } from '@/features/notes/extensions/marks'
import { displayDoc, parseRichDoc, plainFromRich, type RichInlineDoc } from '@/lib/richTitle'

const titleExtensions = [
  StarterKit.configure({
    heading: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    blockquote: false,
    codeBlock: false,
    code: false,
    horizontalRule: false,
    hardBreak: false,
    link: false,
    underline: false,
  }),
  Underline,
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  Placeholder.configure({
    placeholder: ({ editor }) => editor.view.dom.getAttribute('data-placeholder') ?? '',
  }),
]

export type TitleEditorHost = HTMLElement & { __editorView?: EditorView }

export function TitleInlineEditor({
  id,
  plain,
  rich,
  ariaLabel,
  placeholder,
  className = '',
  dir = 'auto',
  caret = 'end',
  autoFocus = true,
  onChange,
  onKeyDown,
  onBlur,
  onFocus,
}: {
  id: string
  plain: string
  rich?: unknown
  ariaLabel: string
  placeholder?: string
  className?: string
  dir?: 'auto' | 'ltr' | 'rtl'
  caret?: 'start' | 'end'
  autoFocus?: boolean
  onChange: (plain: string, rich: RichInlineDoc, caret: number) => void
  onKeyDown: (event: KeyboardEvent, caret: number, empty: boolean, collapsed: boolean, plain: string, rich: RichInlineDoc) => boolean
  onBlur: () => void
  onFocus: () => void
}) {
  const initial = displayDoc(plain, rich)

  const editor = useEditor({
    extensions: titleExtensions,
    content: initial,
    autofocus: false,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: `title-pm ${className}`.trim(),
        spellcheck: 'false',
        'aria-label': ariaLabel,
        placeholder: placeholder ?? '',
        dir,
        'data-placeholder': placeholder ?? '',
      },
      handleScrollToSelection: () => true,
      handleKeyDown: (view, event) => {
        const caretPos = view.state.selection.$from.parentOffset
        const currentPlain = view.state.doc.textContent.replace(/\n/g, '')
        const nextRich = parseRichDoc(view.state.doc.toJSON()) ?? displayDoc(currentPlain, view.state.doc.toJSON())
        return onKeyDown(event, caretPos, !currentPlain.trim(), view.state.selection.empty, currentPlain, nextRich)
      },
    },
    onUpdate: ({ editor: current }) => {
      const nextRich = parseRichDoc(current.getJSON()) ?? displayDoc(current.getText(), current.getJSON())
      onChange(plainFromRich(nextRich), nextRich, current.state.selection.$from.parentOffset)
    },
    onFocus: () => onFocus(),
    onBlur: () => onBlur(),
  })

  useEffect(() => {
    if (!editor || !autoFocus) return
    const frame = requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.commands.focus(caret === 'start' ? 'start' : 'end')
    })
    return () => cancelAnimationFrame(frame)
  }, [editor, id, caret, autoFocus])

  if (!editor) return null

  return (
    <div
      className={`title-inline ${className}`.trim()}
      data-title-editor={id}
      data-plain={plainFromRich(parseRichDoc(editor.getJSON()) ?? initial) || plain}
      data-placeholder={placeholder ?? ''}
      ref={(node) => {
        if (node) (node as TitleEditorHost).__editorView = editor.view
      }}
    >
      <EditorContent editor={editor} />
      <TitleFormatBar editor={editor} />
    </div>
  )
}
