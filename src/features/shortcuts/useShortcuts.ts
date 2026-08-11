import { useEffect } from 'react'
import { extractAndExplain, quickNoteAtCurrentPosition } from '@/services/notes/extract'
import { useAppStore } from '@/state/useAppStore'
import { useStudyStore } from '@/state/useStudyStore'
import type { AnnotationKind } from '@/types'

/**
 * Global keymap (§13).
 *
 * The extract shortcuts fire whether focus is in the PDF or in the editor —
 * during a lesson you have just typed a sentence, you look up, the teacher
 * mentions the next line, you select it and press ⌘E without ever thinking
 * about which pane has focus. Only text *inputs* are excluded, and only for
 * shortcuts that would otherwise eat a keystroke.
 */

export interface ShortcutBinding {
  id: string
  keys: string
  description: string
  group: string
}

export const SHORTCUTS: ShortcutBinding[] = [
  { id: 'extract', keys: 'Ctrl+E', description: 'Extract the selection and explain it', group: 'Study' },
  { id: 'highlight', keys: 'Ctrl+H', description: 'Highlight the selection', group: 'Study' },
  { id: 'benefit', keys: 'Ctrl+Shift+B', description: 'Extract as Fāʾidah', group: 'Study' },
  { id: 'definition', keys: 'Ctrl+Shift+D', description: 'Extract as Definition', group: 'Study' },
  { id: 'teacher', keys: 'Ctrl+Shift+T', description: "Extract as Teacher's explanation", group: 'Study' },
  { id: 'question', keys: 'Ctrl+Shift+Q', description: 'Extract as Question', group: 'Study' },
  { id: 'reference', keys: 'Ctrl+Shift+R', description: 'Extract as Reference', group: 'Study' },
  { id: 'quicknote', keys: 'Ctrl+Shift+N', description: 'Note at my current position', group: 'Study' },
  { id: 'palette', keys: 'Ctrl+K', description: 'Command palette', group: 'Navigate' },
  { id: 'palette2', keys: 'Ctrl+P', description: 'Command palette', group: 'Navigate' },
  { id: 'search', keys: 'Ctrl+Shift+F', description: 'Search the library', group: 'Navigate' },
  { id: 'find', keys: 'Ctrl+F', description: 'Find in the current note', group: 'Navigate' },
  { id: 'lesson', keys: 'Ctrl+Shift+L', description: 'Toggle Lesson Mode', group: 'Layout' },
  { id: 'layout1', keys: 'Ctrl+1', description: 'Library, book and notes', group: 'Layout' },
  { id: 'layout2', keys: 'Ctrl+2', description: 'Study — book and notes', group: 'Layout' },
  { id: 'layout3', keys: 'Ctrl+3', description: 'Book only', group: 'Layout' },
  { id: 'layout4', keys: 'Ctrl+4', description: 'Notes only', group: 'Layout' },
  { id: 'focusnotes', keys: 'Ctrl+Shift+E', description: 'Toggle notes full screen', group: 'Layout' },
  { id: 'theme', keys: 'Ctrl+Shift+M', description: 'Toggle dark / light theme', group: 'Layout' },
  { id: 'help', keys: 'Ctrl+/', description: 'Show keyboard shortcuts', group: 'Layout' },
]

const EXTRACT_KEYS: { key: string; shift: boolean; kind: AnnotationKind }[] = [
  { key: 'e', shift: false, kind: 'explain' },
  { key: 'h', shift: false, kind: 'highlight' },
  { key: 'b', shift: true, kind: 'benefit' },
  { key: 'd', shift: true, kind: 'definition' },
  { key: 't', shift: true, kind: 'teacher' },
  { key: 'q', shift: true, kind: 'question' },
  { key: 'r', shift: true, kind: 'reference' },
]

function inTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function useShortcuts() {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return

      const app = useAppStore.getState()
      const study = useStudyStore.getState()

      // Palette / search / help work everywhere.
      if (!event.shiftKey && (event.key === 'k' || event.key === 'p')) {
        event.preventDefault()
        app.setPaletteOpen(!app.paletteOpen)
        return
      }
      if (event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        app.setSearchOpen(true)
        return
      }
      if (event.key === '/') {
        event.preventDefault()
        app.setShortcutsOpen(!app.shortcutsOpen)
        return
      }
      if (event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        app.toggleLessonMode()
        return
      }
      if (event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault()
        app.toggleTheme()
        return
      }
      if (!event.shiftKey && event.key >= '1' && event.key <= '4') {
        event.preventDefault()
        app.setLayout((['three', 'study', 'pdf', 'notes'] as const)[Number(event.key) - 1])
        return
      }
      // §51 — one key to swap between writing and reading, and back again.
      if (event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        app.toggleFocus('notes')
        return
      }

      if (inTextField(event.target)) return

      if (event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void quickNoteAtCurrentPosition()
        return
      }

      // Extract & Explain and friends. These are the shortcuts the product is
      // actually about, so they stay live while the cursor is in the editor.
      const binding = EXTRACT_KEYS.find(
        (b) => b.shift === event.shiftKey && b.key === event.key.toLowerCase(),
      )
      if (binding) {
        if (!study.selection) return
        event.preventDefault()
        void extractAndExplain(binding.kind, study.selection)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
