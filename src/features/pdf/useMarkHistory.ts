import { useSyncExternalStore } from 'react'
import { markHistory } from '@/services/annotations/history'

export function useMarkHistory() {
  const version = useSyncExternalStore(
    (listener) => markHistory.subscribe(listener),
    () => markHistory.getSnapshot(),
    () => markHistory.getSnapshot(),
  )
  return {
    version,
    canUndo: markHistory.canUndo,
    canRedo: markHistory.canRedo,
  }
}
