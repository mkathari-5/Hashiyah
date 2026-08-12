import type { Editor } from '@tiptap/core'
import { SEMANTIC_KINDS } from '@/features/notes/extensions/SemanticBlock'
import { insertIslamicPhrase, ISLAMIC_PHRASES } from '@/features/notes/islamicPhrases'
import { openQuranPicker } from '@/features/notes/QuranPicker'
import { extractAndExplain, quickNoteAtCurrentPosition } from '@/services/notes/extract'
import { useStudyStore } from '@/state/useStudyStore'

/**
 * One catalogue, two menus.
 *
 * The slash menu (§7) and the block menu's "Turn into" (§6) offer the same
 * vocabulary, so they read from the same list. Adding a block type is one entry
 * here and it appears in both, correctly grouped, with the same keywords.
 */

export type BlockGroup = 'Basic' | 'Islamic text' | 'Islamic study' | 'Sources' | 'Media'

export interface BlockDef {
  id: string
  title: string
  arabic?: string
  group: BlockGroup
  /** Single glyph, matching the one the block itself renders. */
  icon: string
  keywords: string[]
  run: (editor: Editor) => void
  /** Present in the "Turn into" menu — i.e. it converts, rather than inserts. */
  turnInto?: boolean
  /** Hidden when there is nothing selected in the PDF. */
  needsSelection?: boolean
}

const BASIC: BlockDef[] = [
  {
    id: 'paragraph',
    title: 'Text',
    group: 'Basic',
    icon: '¶',
    keywords: ['text', 'paragraph', 'plain', 'body'],
    turnInto: true,
    run: (e) => e.chain().focus().setParagraph().run(),
  },
  {
    id: 'h1',
    title: 'Heading 1',
    group: 'Basic',
    icon: 'H₁',
    keywords: ['h1', 'heading', 'title', 'large'],
    turnInto: true,
    run: (e) => e.chain().focus().setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    title: 'Heading 2',
    group: 'Basic',
    icon: 'H₂',
    keywords: ['h2', 'heading', 'section'],
    turnInto: true,
    run: (e) => e.chain().focus().setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    title: 'Heading 3',
    group: 'Basic',
    icon: 'H₃',
    keywords: ['h3', 'heading', 'subsection'],
    turnInto: true,
    run: (e) => e.chain().focus().setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'bullet',
    title: 'Bulleted list',
    group: 'Basic',
    icon: '•',
    keywords: ['bullet', 'list', 'unordered', 'ul'],
    turnInto: true,
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'number',
    title: 'Numbered list',
    group: 'Basic',
    icon: '1.',
    keywords: ['number', 'ordered', 'list', 'ol'],
    turnInto: true,
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'task',
    title: 'Checklist',
    group: 'Basic',
    icon: '☑',
    keywords: ['task', 'todo', 'check', 'checkbox'],
    turnInto: true,
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'toggle',
    title: 'Toggle',
    group: 'Basic',
    icon: '▸',
    keywords: ['toggle', 'collapse', 'fold', 'details', 'collapsible', 'question'],
    // Turning an existing line into a toggle keeps its text as the title (§33);
    // on an empty line it inserts a fresh one.
    turnInto: true,
    run: (e) =>
      e.state.selection.$from.parent.content.size > 0
        ? e.chain().focus().wrapInToggle().run()
        : e.chain().focus().insertToggle().run(),
  },
  {
    id: 'toggleh1',
    title: 'Toggle heading 1',
    group: 'Basic',
    icon: '▸H₁',
    keywords: ['toggleh1', 'toggle heading', 'section', 'fold'],
    turnInto: true,
    run: (e) =>
      e.state.selection.$from.parent.content.size > 0
        ? e.chain().focus().wrapInToggle({ level: 1 }).run()
        : e.chain().focus().insertToggle({ level: 1 }).run(),
  },
  {
    id: 'toggleh2',
    title: 'Toggle heading 2',
    group: 'Basic',
    icon: '▸H₂',
    keywords: ['toggleh2', 'toggle heading', 'subsection', 'fold'],
    turnInto: true,
    run: (e) =>
      e.state.selection.$from.parent.content.size > 0
        ? e.chain().focus().wrapInToggle({ level: 2 }).run()
        : e.chain().focus().insertToggle({ level: 2 }).run(),
  },
  {
    id: 'quote',
    title: 'Quote',
    group: 'Basic',
    icon: '❝',
    keywords: ['quote', 'blockquote', 'citation'],
    turnInto: true,
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'code',
    title: 'Code',
    group: 'Basic',
    icon: '</>',
    keywords: ['code', 'monospace', 'pre'],
    turnInto: true,
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    title: 'Divider',
    group: 'Basic',
    icon: '—',
    keywords: ['divider', 'rule', 'hr', 'separator', 'line'],
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
]

const ISLAMIC: BlockDef[] = [
  {
    id: 'quranBlock',
    title: "Qur'ān",
    arabic: 'قرآن',
    group: 'Islamic study',
    icon: '﴿﴾',
    keywords: ['quran', 'ayah', 'verse', 'aya', 'quran'],
    run: (e) => openQuranPicker(e),
  },
  {
    id: 'hadithBlock',
    title: 'Ḥadīth',
    arabic: 'حديث',
    group: 'Islamic study',
    icon: '❁',
    keywords: ['hadith', 'narration', 'sunnah'],
    run: (e) => e.chain().focus().insertHadithBlock().run(),
  },
  ...SEMANTIC_KINDS.map<BlockDef>((kind) => ({
    id: `semantic:${kind.kind}`,
    title: kind.label,
    arabic: kind.arabic,
    group: 'Islamic study',
    icon: kind.icon,
    keywords: kind.aliases,
    turnInto: true,
    run: (e) => e.chain().focus().setSemanticBlock(kind.kind).run(),
  })),
]

/** Compact inline honorifics — never blocks. */
const ISLAMIC_TEXT: BlockDef[] = [
  ...ISLAMIC_PHRASES.map<BlockDef>((phrase) => ({
    id: `phrase:${phrase.shortcut}`,
    // Arabic first, shortcut for muscle memory — single line, no duplicate glyph.
    title: `${phrase.text} — /${phrase.shortcut}`,
    group: 'Islamic text',
    icon: 'ـ',
    keywords: [phrase.shortcut, `/${phrase.shortcut}`, phrase.title.toLowerCase(), phrase.text],
    run: (e) => {
      insertIslamicPhrase(e, phrase.text)
    },
  })),
  {
    id: 'saw-symbol',
    title: 'ﷺ — symbol',
    group: 'Islamic text',
    icon: 'ﷺ',
    keywords: ['saw', 'symbol', 'salawat', 'pbuh', 'ﷺ'],
    run: (e) => insertIslamicPhrase(e, 'ﷺ'),
  },
]

const SOURCES: BlockDef[] = [
  {
    id: 'source',
    title: 'Book passage',
    group: 'Sources',
    icon: '❞',
    keywords: ['source', 'passage', 'extract', 'quote', 'book'],
    needsSelection: true,
    run: () => {
      const selection = useStudyStore.getState().selection
      if (selection) void extractAndExplain('explain', selection)
    },
  },
  {
    id: 'here',
    title: 'Current book location',
    group: 'Sources',
    icon: '⌖',
    keywords: ['here', 'location', 'position', 'page', 'current'],
    run: () => void quickNoteAtCurrentPosition(),
  },
]

const MEDIA: BlockDef[] = [
  {
    id: 'table',
    title: 'Table',
    group: 'Media',
    icon: '▦',
    keywords: ['table', 'grid', 'rows', 'columns'],
    run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'image',
    title: 'Image',
    group: 'Media',
    icon: '▣',
    keywords: ['image', 'picture', 'photo', 'diagram', 'scan'],
    run: (e) => e.chain().focus().insertImagePicker().run(),
  },
]

export const BLOCK_CATALOGUE: BlockDef[] = [...BASIC, ...ISLAMIC_TEXT, ...ISLAMIC, ...SOURCES, ...MEDIA]

export const GROUP_ORDER: BlockGroup[] = ['Basic', 'Islamic text', 'Islamic study', 'Sources', 'Media']

/**
 * Ranked filter. An exact keyword match beats a prefix match, which beats a
 * substring — so `/ben` puts Fāʾidah first rather than burying it under
 * anything that merely contains those letters.
 */
export function filterBlocks(query: string, options: { hasPdfSelection?: boolean } = {}): BlockDef[] {
  const available = BLOCK_CATALOGUE.filter((b) => !b.needsSelection || options.hasPdfSelection)
  const q = query.trim().toLowerCase()
  if (!q) return available

  const scored: { block: BlockDef; score: number }[] = []
  for (const block of available) {
    const haystack = [block.title.toLowerCase(), ...block.keywords]
    let score = -1
    for (const term of haystack) {
      if (term === q) score = Math.max(score, 3)
      else if (term.startsWith(q)) score = Math.max(score, 2)
      else if (term.includes(q)) score = Math.max(score, 1)
    }
    if (score > 0) scored.push({ block, score })
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.block)
}

export function groupBlocks(blocks: BlockDef[]): [BlockGroup, BlockDef[]][] {
  const map = new Map<BlockGroup, BlockDef[]>()
  for (const block of blocks) {
    const list = map.get(block.group) ?? []
    list.push(block)
    map.set(block.group, list)
  }
  return GROUP_ORDER.filter((g) => map.has(g)).map((g) => [g, map.get(g)!])
}
