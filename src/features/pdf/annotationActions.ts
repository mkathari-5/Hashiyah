import { AnnotationEngine } from '@/services/annotations/AnnotationEngine'
import {
  recordAnnotationRemoved,
  recordMarkCreated,
  recordMarkRemoved,
  snapshotAnnotation,
} from '@/services/annotations/history'
import { PageMarkEngine, type CreateMarkInput } from '@/services/annotations/PageMarkEngine'
import { extractAndExplain } from '@/services/notes/extract'
import { PdfNoteLinkEngine } from '@/services/notes/PdfNoteLinkEngine'
import { useStudyStore, type LiveSelection } from '@/state/useStudyStore'
import type { PageMark } from '@/types'

const ERASABLE_KINDS = new Set(['highlight', 'underline', 'capture'])

export async function createTrackedMark(input: CreateMarkInput): Promise<PageMark> {
  return PageMarkEngine.create(input)
}

export function commitNewTextMark(mark: PageMark) {
  if (mark.content.trim()) recordMarkCreated(mark)
}

export async function deleteMark(id: string): Promise<void> {
  const removed = await PageMarkEngine.remove(id)
  if (removed?.content.trim() || (removed && removed.kind !== 'text' && removed.kind !== 'margin')) {
    if (removed) recordMarkRemoved(removed)
  }
  const study = useStudyStore.getState()
  if (study.selectedMarkId === id) study.setSelectedMarkId(null)
  if (study.editingMarkId === id) study.setEditingMarkId(null)
}

export async function deleteAnnotationMark(id: string): Promise<boolean> {
  const snap = await snapshotAnnotation(id)
  if (!snap) return false
  if (!ERASABLE_KINDS.has(snap.annotation.kind)) return false
  await AnnotationEngine.remove(id)
  recordAnnotationRemoved(snap.annotation, snap.anchor)
  const study = useStudyStore.getState()
  if (study.activeAnnotationId === id) study.setActiveAnnotation(null)
  return true
}

export async function deleteSelectedAnnotation(): Promise<void> {
  const study = useStudyStore.getState()
  if (study.editingMarkId) return
  if (study.selectedPdfNoteLinkId) {
    await PdfNoteLinkEngine.unlink(study.selectedPdfNoteLinkId)
    return
  }
  if (study.selectedMarkId) {
    await deleteMark(study.selectedMarkId)
    return
  }
  if (study.activeAnnotationId) await deleteAnnotationMark(study.activeAnnotationId)
}

export async function applySelectionMarkup(kind: 'highlight' | 'underline', selection?: LiveSelection | null) {
  const live = selection ?? useStudyStore.getState().selection
  if (!live) return
  await extractAndExplain(kind, live)
}
