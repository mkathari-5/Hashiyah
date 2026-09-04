import type { Editor } from '@tiptap/core'

/**
 * Insert a table after the current block when that block already has content.
 * Tiptap's default insertTable replaces the selection, which would wipe a
 * heading the user had just selected for formatting.
 */
export function insertTableSafely(editor: Editor, rows = 3, cols = 3) {
  editor.commands.setTextSelection(editor.state.selection.to)
  const { $from } = editor.state.selection
  if ($from.depth >= 1 && $from.parent.content.size > 0) {
    const pos = $from.after($from.depth)
    editor.chain().focus().insertContentAt(pos, { type: 'paragraph' }).run()
  }
  editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
}
