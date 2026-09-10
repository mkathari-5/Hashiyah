/**
 * Browser history for Library home ↔ study workspace.
 *
 * Opening a book pushes a study entry so Back returns to the homepage without
 * discarding notes (those are already persisted). Refresh still hydrates from
 * `activeLibraryNode`; the hash is a hint, not a second source of truth.
 */

export type WorkspaceView = 'library' | 'study'

export interface WorkspaceHistoryPayload {
  view: WorkspaceView
  nodeId: string | null
}

const KEY = 'hashiyahWorkspace'

function payloadFromUnknown(value: unknown): WorkspaceHistoryPayload | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const inner = record[KEY]
  if (!inner || typeof inner !== 'object') return null
  const view = (inner as Record<string, unknown>).view
  const nodeId = (inner as Record<string, unknown>).nodeId
  if (view !== 'library' && view !== 'study') return null
  return { view, nodeId: typeof nodeId === 'string' ? nodeId : null }
}

export function readWorkspaceHash(hash = typeof location === 'undefined' ? '' : location.hash): WorkspaceHistoryPayload | null {
  const raw = hash.replace(/^#/, '')
  if (raw === '/library' || raw === 'library') return { view: 'library', nodeId: null }
  const study = raw.match(/^\/?study\/(.+)$/)
  if (study?.[1]) return { view: 'study', nodeId: decodeURIComponent(study[1]) }
  return null
}

export function readWorkspaceHistory(
  state: unknown = typeof history === 'undefined' ? null : history.state,
  hash = typeof location === 'undefined' ? '' : location.hash,
): WorkspaceHistoryPayload | null {
  return payloadFromUnknown(state) ?? readWorkspaceHash(hash)
}

function hashFor(payload: WorkspaceHistoryPayload): string {
  if (payload.view === 'study' && payload.nodeId) return `#/study/${encodeURIComponent(payload.nodeId)}`
  return '#/library'
}

function write(payload: WorkspaceHistoryPayload, mode: 'push' | 'replace') {
  if (typeof history === 'undefined') return
  const next = { [KEY]: payload }
  const url = hashFor(payload)
  if (mode === 'replace') history.replaceState(next, '', url)
  else history.pushState(next, '', url)
}

export function pushLibraryHistory() {
  const current = readWorkspaceHistory()
  if (current?.view === 'library') return
  write({ view: 'library', nodeId: null }, 'push')
}

export function pushStudyHistory(nodeId: string) {
  const current = readWorkspaceHistory()
  if (current?.view === 'study' && current.nodeId === nodeId) return
  write({ view: 'study', nodeId }, 'push')
}

export function replaceStudyHistory(nodeId: string) {
  write({ view: 'study', nodeId }, 'replace')
}

export function replaceLibraryHistory() {
  write({ view: 'library', nodeId: null }, 'replace')
}
