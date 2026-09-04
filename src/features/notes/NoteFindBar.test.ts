import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { collectFindHits, replaceFindHits } from '@/features/notes/NoteFindBar'
import { noteExtensions } from '@/features/notes/NoteEditor'

function makeEditor(content: string) {
  return new Editor({
    extensions: noteExtensions,
    content,
  })
}

describe('note find and replace', () => {
  it('finds normalised Arabic and Latin hits', () => {
    const editor = makeEditor('<p>ٱلْحَنِيفِيَّة and الحنيفية twice</p>')
    const hits = collectFindHits(editor, 'الحنيفية')
    expect(hits.length).toBeGreaterThanOrEqual(2)
    editor.destroy()
  })

  it('replaces every hit and recounts as empty', () => {
    const editor = makeEditor('<p>wudu wudu wudu</p>')
    const hits = collectFindHits(editor, 'wudu')
    expect(hits).toHaveLength(3)
    replaceFindHits(editor, hits, 'ablution')
    expect(collectFindHits(editor, 'wudu')).toHaveLength(0)
    expect(collectFindHits(editor, 'ablution')).toHaveLength(3)
    editor.destroy()
  })

  it('replacing one hit leaves the remaining matches', () => {
    const editor = makeEditor('<p>alpha alpha alpha</p>')
    const hits = collectFindHits(editor, 'alpha')
    replaceFindHits(editor, [hits[0]!], 'beta')
    expect(collectFindHits(editor, 'alpha')).toHaveLength(2)
    expect(editor.getText()).toContain('beta')
    editor.destroy()
  })
})
