import { anchorsRepo, annotationsRepo } from '@/db/repos/annotations'
import { pageMarksRepo } from '@/db/repos/pageMarks'
import { AnnotationEngine } from '@/services/annotations/AnnotationEngine'
import { PageMarkEngine } from '@/services/annotations/PageMarkEngine'
import type { Annotation, AnnotationAnchor, PageMark } from '@/types'

export interface HistoryEntry<T> {
  undo: T
  redo: T
}

export class UndoStack<T> {
  private undoItems: HistoryEntry<T>[] = []
  private redoItems: HistoryEntry<T>[] = []
  private listeners = new Set<() => void>()
  private version = 0

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot() {
    return this.version
  }

  private notify() {
    this.version += 1
    for (const listener of this.listeners) listener()
  }

  push(entry: HistoryEntry<T>) {
    this.undoItems.push(entry)
    this.redoItems = []
    this.notify()
  }

  undo(): T | null {
    const entry = this.undoItems.pop()
    if (!entry) return null
    this.redoItems.push(entry)
    this.notify()
    return entry.undo
  }

  redo(): T | null {
    const entry = this.redoItems.pop()
    if (!entry) return null
    this.undoItems.push(entry)
    this.notify()
    return entry.redo
  }

  get canUndo() {
    return this.undoItems.length > 0
  }

  get canRedo() {
    return this.redoItems.length > 0
  }

  clear() {
    this.undoItems = []
    this.redoItems = []
    this.notify()
  }
}

export type MarkHistoryCommand =
  | { type: 'remove-mark'; id: string }
  | { type: 'restore-mark'; mark: PageMark }
  | { type: 'put-mark'; mark: PageMark }
  | { type: 'remove-annotation'; id: string }
  | { type: 'restore-annotation'; annotation: Annotation; anchor: AnnotationAnchor }

export const markHistory = new UndoStack<MarkHistoryCommand>()

export async function applyHistoryCommand(command: MarkHistoryCommand): Promise<void> {
  switch (command.type) {
    case 'remove-mark':
      await PageMarkEngine.remove(command.id)
      return
    case 'restore-mark':
      await PageMarkEngine.restore(command.mark)
      return
    case 'put-mark':
      await pageMarksRepo.put(command.mark)
      return
    case 'remove-annotation':
      await AnnotationEngine.remove(command.id)
      return
    case 'restore-annotation':
      await annotationsRepo.restore(command.annotation, command.anchor)
  }
}

export async function undoMarkHistory(): Promise<boolean> {
  const command = markHistory.undo()
  if (!command) return false
  await applyHistoryCommand(command)
  return true
}

export async function redoMarkHistory(): Promise<boolean> {
  const command = markHistory.redo()
  if (!command) return false
  await applyHistoryCommand(command)
  return true
}

export function recordMarkCreated(mark: PageMark) {
  markHistory.push({
    undo: { type: 'remove-mark', id: mark.id },
    redo: { type: 'restore-mark', mark },
  })
}

export function recordMarkRemoved(mark: PageMark) {
  markHistory.push({
    undo: { type: 'restore-mark', mark },
    redo: { type: 'remove-mark', id: mark.id },
  })
}

export function recordMarkUpdated(before: PageMark, after: PageMark) {
  markHistory.push({
    undo: { type: 'put-mark', mark: before },
    redo: { type: 'put-mark', mark: after },
  })
}

export async function recordAnnotationCreated(annotation: Annotation, anchor: AnnotationAnchor) {
  markHistory.push({
    undo: { type: 'remove-annotation', id: annotation.id },
    redo: { type: 'restore-annotation', annotation, anchor },
  })
}

export async function snapshotAnnotation(id: string): Promise<{ annotation: Annotation; anchor: AnnotationAnchor } | null> {
  const annotation = await annotationsRepo.get(id)
  const anchor = await anchorsRepo.forAnnotation(id)
  if (!annotation || !anchor) return null
  return { annotation, anchor }
}

export function recordAnnotationUpdated(
  before: { annotation: Annotation; anchor: AnnotationAnchor },
  after: { annotation: Annotation; anchor: AnnotationAnchor },
) {
  markHistory.push({
    undo: { type: 'restore-annotation', annotation: before.annotation, anchor: before.anchor },
    redo: { type: 'restore-annotation', annotation: after.annotation, anchor: after.anchor },
  })
}

export function recordAnnotationRemoved(annotation: Annotation, anchor: AnnotationAnchor) {
  markHistory.push({
    undo: { type: 'restore-annotation', annotation, anchor },
    redo: { type: 'remove-annotation', id: annotation.id },
  })
}
