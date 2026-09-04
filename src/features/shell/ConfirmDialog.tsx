import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  children,
  onConfirm,
  onCancel,
}: {
  title: string
  body: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  children?: React.ReactNode
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return createPortal(
    <div className="confirm-layer" role="presentation">
      <button type="button" className="confirm-backdrop" aria-label="Cancel" onClick={onCancel} />
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="confirm-dialog">
        <h2 id="confirm-title" className="confirm-title">
          {title}
        </h2>
        {body ? <p className="confirm-body">{body}</p> : null}
        {children}
        <div className="confirm-actions">
          <button type="button" className="ui-btn" onClick={onCancel}>
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
