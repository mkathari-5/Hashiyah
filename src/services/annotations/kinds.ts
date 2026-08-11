import type { AnnotationKind, HighlightColor } from '@/types'

export interface KindMeta {
  kind: AnnotationKind
  label: string
  /** Arabic label where the term is genuinely Arabic; omitted where it is not. */
  arabic?: string
  color: HighlightColor
  /** Semantic block inserted beneath the quotation, if any. */
  block: string | null
  shortcut?: string
}

/**
 * The vocabulary of the selection menu, the context menu and the shortcuts,
 * defined once. Ordered by expected frequency — `explain` first, because it is
 * the default action and the one bound to ⌘E.
 */
export const KIND_META: Record<AnnotationKind, KindMeta> = {
  explain: { kind: 'explain', label: 'Explain', color: 'amber', block: null, shortcut: 'Mod+E' },
  highlight: { kind: 'highlight', label: 'Highlight', color: 'amber', block: null, shortcut: 'Mod+H' },
  benefit: {
    kind: 'benefit',
    label: 'Fāʾidah',
    arabic: 'فائدة',
    color: 'green',
    block: 'benefit',
    shortcut: 'Mod+Shift+B',
  },
  definition: {
    kind: 'definition',
    label: 'Definition',
    arabic: 'تعريف',
    color: 'blue',
    block: 'definition',
    shortcut: 'Mod+Shift+D',
  },
  teacher: {
    kind: 'teacher',
    label: 'Teacher explanation',
    color: 'amber',
    block: 'teacher',
    shortcut: 'Mod+Shift+T',
  },
  evidence: {
    kind: 'evidence',
    label: 'Evidence',
    arabic: 'دليل',
    color: 'violet',
    block: 'evidence',
  },
  question: {
    kind: 'question',
    label: 'Question',
    color: 'rose',
    block: 'question',
    shortcut: 'Mod+Shift+Q',
  },
  reference: {
    kind: 'reference',
    label: 'Reference',
    color: 'neutral',
    block: 'reference',
    shortcut: 'Mod+Shift+R',
  },
  important: { kind: 'important', label: 'Important', color: 'rose', block: 'important' },
  capture: { kind: 'capture', label: 'Captured region', color: 'neutral', block: null },
}

/** Menu order. Most-used first — this is the §71 requirement. */
export const MENU_ORDER: AnnotationKind[] = [
  'explain',
  'highlight',
  'benefit',
  'definition',
  'teacher',
  'evidence',
  'question',
  'reference',
  'important',
]
