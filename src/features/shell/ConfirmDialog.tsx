import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  initialFocus,
  children,
  onConfirm,
  onCancel,
}: {
  title: string
  body: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** Dangerous deletes focus Cancel so Enter after a menu cannot confirm. */
  initialFocus?: 'cancel' | 'confirm' | 'first-input'
  children?: React.ReactNode
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const focus =
    initialFocus ?? (children ? 'first-input' : danger ? 'cancel' : 'confirm')

  useEffect(() => {
    if (focus === 'first-input') {
      dialogRef.current?.querySelector<HTMLElement>('input, textarea, [contenteditable="true"]')?.focus()
    } else if (focus === 'cancel') {
      cancelRef.current?.focus()
    } else {
      confirmRef.current?.focus()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, focus])

  return createPortal(
    <div className="confirm-layer" role="presentation">
      <button type="button" className="confirm-backdrop" aria-label="Cancel" onClick={onCancel} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="confirm-dialog"
      >
        <h2 id="confirm-title" className="confirm-title">
          {title}
        </h2>
        {body ? <p className="confirm-body">{body}</p> : null}
        {children}
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="ui-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`ui-btn ${danger ? 'ui-btn-danger' : 'ui-btn-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
