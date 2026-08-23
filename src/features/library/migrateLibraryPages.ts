import { db } from '@/db/db'
import { libraryBlocksRepo, libraryPagesRepo, ROOT_LIBRARY_PAGE_ID } from '@/db/repos/libraryPages'
import { libraryRepo } from '@/db/repos/libraryTree'
import { appStateRepo } from '@/db/repos/session'
import { isSafeLegacyEmptyPlaceholder } from '@/features/library/legacyEmptyNodes'
import { PREVIOUS_LIBRARY_TITLE } from '@/features/library/libraryPageModel'
import { newId } from '@/lib/id'
import type { LibraryBlock, LibraryNode } from '@/types'

/**
 * One-time, idempotent import of the legacy study tree onto the new Library
 * page.
 *
 * Safety rules:
 *  - Never clears IndexedDB and never deletes libraryNodes, notes, PDFs or books.
 *  - Skips blank leftover composer rows (the same ones purgeLegacyEmptyPlaceholders
 *    would remove). A stored title of "Untitled" is real content.
 *  - Empty containers are imported as Study blocks, not converted into empty toggles.
 *  - The new root page stays titled "Library" and is not filled with generated blanks.
 *  - Meaningful nodes land under a "Previous Library" toggle so the canvas remains
 *    the user's to write on.
 */

export const LIBRARY_PAGES_MIGRATION_KEY = 'libraryPagesMigrationVersion'
export const LIBRARY_PAGES_MIGRATION_VERSION = 1

export interface LibraryPagesMigrationResult {
  ran: boolean
  imported: number
  skippedPlaceholders: number
}

let inFlight: Promise<LibraryPagesMigrationResult> | null = null

export function migrateLibraryPages(): Promise<LibraryPagesMigrationResult> {
  if (!inFlight) {
    inFlight = runMigration().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

async function runMigration(): Promise<LibraryPagesMigrationResult> {
  const version = await appStateRepo.get<number>(LIBRARY_PAGES_MIGRATION_KEY, 0)
  if (version >= LIBRARY_PAGES_MIGRATION_VERSION) {
    await libraryPagesRepo.ensureRoot()
    return { ran: false, imported: 0, skippedPlaceholders: 0 }
  }

  return db.transaction(
    'rw',
    db.libraryPages,
    db.libraryBlocks,
    db.libraryNodes,
    db.appState,
    () => migrateWithin(),
  )
}

async function migrateWithin(): Promise<LibraryPagesMigrationResult> {
  const already = await appStateRepo.get<number>(LIBRARY_PAGES_MIGRATION_KEY, 0)
  if (already >= LIBRARY_PAGES_MIGRATION_VERSION) {
    await libraryPagesRepo.ensureRoot()
    return { ran: false, imported: 0, skippedPlaceholders: 0 }
  }

  await libraryPagesRepo.ensureRoot()

  const nodes = await libraryRepo.all()
  const childCount = new Map<string, number>()
  for (const node of nodes) {
    if (node.parentId) childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1)
  }

  let skippedPlaceholders = 0
  const importable: LibraryNode[] = []
  for (const node of nodes) {
    if (isSafeLegacyEmptyPlaceholder(node, childCount.get(node.id) ?? 0)) {
      skippedPlaceholders += 1
      continue
    }
    importable.push(node)
  }

  if (importable.length === 0) {
    await appStateRepo.set(LIBRARY_PAGES_MIGRATION_KEY, LIBRARY_PAGES_MIGRATION_VERSION)
    return { ran: true, imported: 0, skippedPlaceholders }
  }

  const existing = await libraryBlocksRepo.forPage(ROOT_LIBRARY_PAGE_ID)
  const alreadyLinked = new Set(
    existing.map((block) => block.libraryNodeId).filter((id): id is string => !!id),
  )
  if (importable.every((node) => alreadyLinked.has(node.id))) {
    await appStateRepo.set(LIBRARY_PAGES_MIGRATION_KEY, LIBRARY_PAGES_MIGRATION_VERSION)
    return { ran: true, imported: 0, skippedPlaceholders }
  }

  const now = Date.now()
  const sectionId = newId('lblk')
  const section: LibraryBlock = {
    id: sectionId,
    pageId: ROOT_LIBRARY_PAGE_ID,
    parentBlockId: null,
    type: 'toggle',
    content: PREVIOUS_LIBRARY_TITLE,
    order: existing.filter((block) => block.parentBlockId === null).length,
    expanded: false,
    createdAt: now,
    updatedAt: now,
  }
  await db.libraryBlocks.add(section)

  const nodeIds = new Set(importable.map((node) => node.id))
  const blockIdByNode = new Map<string, string>()
  for (const node of importable) blockIdByNode.set(node.id, newId('lblk'))

  const parentBlockIdFor = (node: LibraryNode): string => {
    let parentId = node.parentId
    const seen = new Set<string>()
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      const mapped = blockIdByNode.get(parentId)
      if (mapped) return mapped
      parentId = nodes.find((row) => row.id === parentId)?.parentId ?? null
    }
    return sectionId
  }

  const byParent = new Map<string | null, LibraryNode[]>()
  for (const node of importable) {
    const parentKey = node.parentId && nodeIds.has(node.parentId) ? node.parentId : null
    const list = byParent.get(parentKey) ?? []
    list.push(node)
    byParent.set(parentKey, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

  const rows: LibraryBlock[] = []
  const walk = (parentNodeId: string | null) => {
    const kids = byParent.get(parentNodeId) ?? []
    kids.forEach((node, order) => {
      rows.push({
        id: blockIdByNode.get(node.id)!,
        pageId: ROOT_LIBRARY_PAGE_ID,
        parentBlockId: parentNodeId ? blockIdByNode.get(parentNodeId)! : parentBlockIdFor(node),
        type: 'study',
        content: studyLabel(node),
        order,
        expanded: false,
        libraryNodeId: node.id,
        createdAt: node.createdAt,
        updatedAt: now,
      })
      walk(node.id)
    })
  }
  walk(null)

  if (rows.length) await db.libraryBlocks.bulkAdd(rows)
  await appStateRepo.set(LIBRARY_PAGES_MIGRATION_KEY, LIBRARY_PAGES_MIGRATION_VERSION)

  return { ran: true, imported: rows.length, skippedPlaceholders }
}

function studyLabel(node: LibraryNode): string {
  const title = node.title?.trim() ?? ''
  const arabic = node.arabicTitle?.trim() ?? ''
  if (title && arabic) return `${title} — ${arabic}`
  return title || arabic
}

/** Ready the editor: migrate once, then guarantee the root page exists. */
export async function ensureLibraryPageReady() {
  await migrateLibraryPages()
  await libraryPagesRepo.ensureRoot()
}
