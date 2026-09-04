import { Icon, type IconName } from '@/features/shell/Icon'
import { deleteSelectedAnnotation } from '@/features/pdf/annotationActions'
import { useMarkHistory } from '@/features/pdf/useMarkHistory'
import { redoMarkHistory, undoMarkHistory } from '@/services/annotations/history'
import type { PdfTool } from '@/state/useStudyStore'
import { useStudyStore } from '@/state/useStudyStore'
import type { OcrLanguage } from '@/types'

const TOOLS: { id: PdfTool; label: string; hint: string; icon: IconName }[] = [
  { id: 'select', label: 'Select', hint: 'Esc', icon: 'cursor' },
  { id: 'pan', label: 'Pan', hint: 'Hold space', icon: 'hand' },
  { id: 'text', label: 'Text', hint: 'T', icon: 'pencil' },
  { id: 'highlight', label: 'Highlight', hint: 'H', icon: 'highlight' },
  { id: 'underline', label: 'Underline', hint: 'U', icon: 'underline' },
  { id: 'erase', label: 'Delete', hint: 'Del', icon: 'eraser' },
]

export function AnnotationToolbar({
  ocrStatus,
  onRetryOcr,
  onCancelOcr,
}: {
  ocrStatus?: { pageNumber: number | null; progress: number; status: string; error: string | null }
  onRetryOcr?: () => void
  onCancelOcr?: () => void
}) {
  const tool = useStudyStore((s) => s.pdfTool)
  const setTool = useStudyStore((s) => s.setPdfTool)
  const rotation = useStudyStore((s) => s.pageRotation)
  const setRotation = useStudyStore((s) => s.setPageRotation)
  const language = useStudyStore((s) => s.ocrLanguage)
  const setLanguage = useStudyStore((s) => s.setOcrLanguage)
  const selectedMarkId = useStudyStore((s) => s.selectedMarkId)
  const activeAnnotationId = useStudyStore((s) => s.activeAnnotationId)
  const { canUndo, canRedo } = useMarkHistory()

  return (
    <div className="pdf-annot-bar" role="toolbar" aria-label="PDF annotation tools">
      {TOOLS.map((item) => (
        <button
          key={item.id}
          type="button"
          title={`${item.label} · ${item.hint}`}
          aria-label={item.label}
          aria-pressed={tool === item.id}
          className={`pdf-annot-btn${tool === item.id ? ' is-active' : ''}`}
          onClick={() => setTool(item.id)}
        >
          <Icon name={item.icon} />
        </button>
      ))}

      <span className="pdf-annot-sep" />

      <button
        type="button"
        className="pdf-annot-btn"
        title="Undo · Ctrl Z"
        aria-label="Undo"
        disabled={!canUndo}
        onClick={() => void undoMarkHistory()}
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        className="pdf-annot-btn"
        title="Redo · Ctrl Shift Z"
        aria-label="Redo"
        disabled={!canRedo}
        onClick={() => void redoMarkHistory()}
      >
        <Icon name="redo" />
      </button>
      <button
        type="button"
        className="pdf-annot-btn"
        title="Delete selected"
        aria-label="Delete selected"
        disabled={!selectedMarkId && !activeAnnotationId}
        onClick={() => void deleteSelectedAnnotation()}
      >
        <Icon name="trash" />
      </button>

      <span className="pdf-annot-sep" />

      <button
        type="button"
        className="pdf-annot-btn"
        title="Rotate page"
        aria-label="Rotate page"
        onClick={() => setRotation((((rotation + 90) % 360) as 0 | 90 | 180 | 270))}
      >
        <Icon name="rotate" />
      </button>

      <label className="pdf-annot-lang">
        <span className="sr-only">OCR language</span>
        <select
          value={language}
          onChange={(event) => setLanguage(event.target.value as OcrLanguage)}
          title="OCR language"
        >
          <option value="ara+eng">Arabic + English</option>
          <option value="ara">Arabic</option>
          <option value="eng">English</option>
          <option value="auto">Automatic</option>
        </select>
      </label>

      {ocrStatus && ocrStatus.status !== 'idle' && (
        <span className="pdf-annot-ocr">
          {ocrStatus.status === 'error'
            ? ocrStatus.error
            : ocrStatus.status === 'cancelled'
              ? 'OCR cancelled'
              : `OCR p.${ocrStatus.pageNumber ?? '—'} ${Math.round(ocrStatus.progress * 100)}%`}
          {(ocrStatus.status === 'recognising' || ocrStatus.status === 'rendering') && onCancelOcr && (
            <button type="button" className="pdf-annot-link" onClick={onCancelOcr}>
              Cancel
            </button>
          )}
          {(ocrStatus.status === 'error' || ocrStatus.status === 'cancelled') && onRetryOcr && (
            <button type="button" className="pdf-annot-link" onClick={onRetryOcr}>
              Retry
            </button>
          )}
        </span>
      )}
    </div>
  )
}
