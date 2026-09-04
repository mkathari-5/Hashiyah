/** True when a keystroke belongs to an editor, not the PDF annotation tools. */
export function isTypingContext(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return Boolean(
    el.closest?.(
      'input, textarea, select, [contenteditable="true"], .ProseMirror, .page-editor, .page-mark-text',
    ),
  )
}
