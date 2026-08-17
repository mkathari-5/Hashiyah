/* eslint-disable */
/**
 * TEMPORARY development harness for the toggle work — not imported by the app.
 *
 * Loaded from the browser console with
 *   await import('/src/dev/toggleHarness.tsx')
 * so the real extension set and the real stylesheet drive a throwaway editor,
 * without touching the reader's library or note database.
 *
 * It goes through `EditorContent`, because Tiptap's `ReactRenderer` (the slash
 * menu, every React node view) renders into the portal registry owned by that
 * component — a bare `new Editor()` would silently draw none of them.
 */
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { noteExtensions } from '@/features/notes/NoteEditor'

declare global {
  interface Window {
    __toggleHarness?: Editor
  }
}

function Harness() {
  const editor = useEditor({
    extensions: noteExtensions,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    autofocus: true,
    immediatelyRender: false,
    editorProps: { attributes: { class: 'ProseMirror focus:outline-none' } },
  })

  useEffect(() => {
    if (editor) window.__toggleHarness = editor
  }, [editor])

  if (!editor) return null
  return <EditorContent editor={editor} />
}

export function mount() {
  document.getElementById('toggle-harness')?.remove()
  const host = document.createElement('div')
  host.id = 'toggle-harness'
  host.style.cssText =
    'position:fixed;inset:60px 60px auto 60px;z-index:9999;background:var(--color-bg,#fff);' +
    'border:1px solid #8884;border-radius:8px;padding:24px;max-height:70vh;overflow:auto'
  const mountPoint = document.createElement('div')
  mountPoint.className = 'note-surface'
  host.appendChild(mountPoint)
  document.body.appendChild(host)
  createRoot(mountPoint).render(<Harness />)
}

mount()
