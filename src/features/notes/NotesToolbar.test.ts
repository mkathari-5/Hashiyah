import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { insertTableSafely } from '@/features/notes/insertHelpers'
import { noteExtensions } from '@/features/notes/NoteEditor'
import { countCharacters, countWords } from '@/services/notes/NotesService'

function makeEditor(content = 'Hello world') {
  return new Editor({
    extensions: noteExtensions,
    content,
  })
}

describe('Word-style note marks', () => {
  it('applies character formatting and round-trips it', () => {
    const editor = makeEditor()
    editor.commands.selectAll()
    editor.commands.toggleBold()
    editor.commands.toggleItalic()
    editor.commands.toggleUnderline()
    editor.commands.toggleStrike()
    editor.commands.setColor('#7a4a48')
    editor.commands.setHighlight({ color: '#f3d9a0' })
    editor.commands.setFontSize('18px')
    editor.commands.setFontFamily('Georgia, "Times New Roman", serif')
    editor.commands.toggleSuperscript()
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"bold"')
    expect(json).toContain('"italic"')
    expect(json).toContain('"underline"')
    expect(json).toContain('"strike"')
    expect(json).toContain('#7a4a48')
    expect(json).toContain('#f3d9a0')
    expect(json).toContain('18px')
    editor.commands.unsetAllMarks()
    expect(JSON.stringify(editor.getJSON())).not.toContain('"underline"')
    editor.destroy()
  })

  it('applies paragraph styles, lists, direction and spacing', () => {
    const editor = makeEditor()
    editor.commands.setTextSelection(1)
    editor.commands.setHeading({ level: 1 })
    expect(editor.isActive('heading', { level: 1 })).toBe(true)
    editor.commands.setParagraph()
    editor.commands.setBlockAlign('center')
    editor.commands.setBlockDirection('rtl')
    editor.commands.setLineHeight('2')
    editor.commands.adjustBlockIndent(2)
    const styled = JSON.stringify(editor.getJSON())
    expect(styled).toContain('"rtl"')
    expect(styled).toContain('"center"')
    expect(styled).toContain('"2"')
    editor.commands.toggleBulletList()
    expect(editor.isActive('bulletList')).toBe(true)
    editor.commands.toggleOrderedList()
    editor.commands.toggleTaskList()
    editor.commands.toggleBlockquote()
    editor.destroy()
  })

  it('inserts a table after a heading instead of replacing it', () => {
    const editor = makeEditor()
    editor.commands.selectAll()
    editor.commands.setHeading({ level: 1 })
    insertTableSafely(editor, 2, 2)
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"heading"')
    expect(json).toContain('Hello world')
    expect(json).toContain('"table"')
    editor.destroy()
  })

  it('inserts a table without flattening custom nodes', () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
    expect(editor.isActive('table')).toBe(true)
    editor.commands.insertToggle()
    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"table"')
    expect(json).toContain('"toggleBlock"')
    editor.destroy()
  })

  it('counts words and characters', () => {
    const editor = makeEditor('مرحبا Hello')
    expect(countWords(editor.getJSON())).toBe(2)
    expect(countCharacters(editor.getJSON())).toBe('مرحبا Hello'.length)
    editor.destroy()
  })
})
