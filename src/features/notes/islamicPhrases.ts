import type { Editor } from '@tiptap/core'

/**
 * Fast inline Islamic honorifics.
 *
 * Inserted at the caret as ordinary text — never as blocks — so they work in
 * paragraphs, headings, toggle titles and toggle bodies without changing
 * direction, alignment or block type.
 */

export interface IslamicPhrase {
  /** Slash keyword without the leading slash, e.g. `saw`. */
  shortcut: string
  /** Exact Arabic (or symbol) inserted at the cursor. */
  text: string
  /** Short Latin label for the slash menu. */
  title: string
}

export const ISLAMIC_PHRASES: IslamicPhrase[] = [
  { shortcut: 'saw', text: 'صلى الله عليه وسلم', title: 'Ṣallallāhu ʿalayhi wa sallam' },
  { shortcut: 'azz', text: 'عز وجل', title: 'ʿAzza wa jall' },
  { shortcut: 'swt', text: 'سبحانه وتعالى', title: 'Subḥānahu wa taʿālā' },
  { shortcut: 'jwa', text: 'جل وعلا', title: 'Jalla wa ʿalā' },
]

/** Insert the phrase at the current selection without forcing surrounding spaces. */
export function insertIslamicPhrase(editor: Editor, text: string): boolean {
  return editor.chain().focus().insertContent(text).run()
}

export function phraseByShortcut(shortcut: string): IslamicPhrase | undefined {
  const key = shortcut.replace(/^\//, '').toLowerCase()
  return ISLAMIC_PHRASES.find((p) => p.shortcut === key)
}
