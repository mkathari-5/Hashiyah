import { db } from '@/db/db'
import type { ReadingState } from '@/types'

export const readingStateRepo = {
  get: (bookId: string) => db.readingStates.get(bookId),
  put: (state: Omit<ReadingState, 'updatedAt'>) =>
    db.readingStates.put({ ...state, updatedAt: Date.now() }),
}

export const appStateRepo = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await db.appState.get(key)
    return row === undefined ? fallback : (row.value as T)
  },
  set: (key: string, value: unknown) => db.appState.put({ key, value }),
}
