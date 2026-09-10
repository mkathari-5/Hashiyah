import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { findBlockPos, openAncestorToggles } from '@/features/notes/extensions/toggleOutline'

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function cssBlockSelector(blockId: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return `[data-block-id="${CSS.escape(blockId)}"]`
  }
  return `[data-block-id="${blockId.replace(/"/g, '')}"]`
}

/** Open every collapsed toggle wrapping `blockId`. Returns whether the block exists. */
export function expandAncestorsForBlock(editor: Editor, blockId: string): boolean {
  const pos = findBlockPos(editor.state, blockId)
  if (pos === null) return false
  const tr = openAncestorToggles(editor.state, pos)
  if (tr) editor.view.dispatch(tr)
  return true
}

function placeCaretInBlock(editor: Editor, blockId: string) {
  const pos = findBlockPos(editor.state, blockId)
  if (pos === null) return
  const node = editor.state.doc.nodeAt(pos)
  let target = pos + 1
  if (node?.type.name === 'toggleBlock' && node.childCount > 1) {
    target = pos + 1 + node.child(0).nodeSize + 1
  }
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(Math.min(target, editor.state.doc.content.size)), 1)),
  )
  editor.view.focus()
}

function pulseBlock(el: HTMLElement) {
  el.classList.remove('block-pulse')
  void el.offsetWidth
  el.classList.add('block-pulse')
  window.setTimeout(() => el.classList.remove('block-pulse'), 1200)
}

/**
 * Expand ancestors, wait for the React node views to paint, then scroll and
 * pulse. No long timeout — two animation frames after the (synchronous)
 * ProseMirror dispatch is enough for the toggle body to exist in the DOM.
 */
export function revealEditorBlock(
  editor: Editor,
  scrollRoot: HTMLElement | null,
  blockId: string,
  options?: { placeCaret?: boolean },
): void {
  if (!expandAncestorsForBlock(editor, blockId)) return

  const run = (): boolean => {
    const el = scrollRoot?.querySelector<HTMLElement>(cssBlockSelector(blockId))
    if (!el) return false
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'center',
      })
    }
    pulseBlock(el)
    if (options?.placeCaret) {
      placeCaretInBlock(editor, blockId)
    } else {
      el.setAttribute('tabindex', '-1')
      if (typeof el.focus === 'function') el.focus({ preventScroll: true })
    }
    return true
  }

  requestAnimationFrame(() => {
    if (run()) return
    requestAnimationFrame(() => {
      run()
    })
  })
}
