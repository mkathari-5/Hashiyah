import { db } from '@/db/db'
import {
  libraryPagesRepo,
  PREVIOUS_LIBRARY_PAGE_ID,
  ROOT_LIBRARY_PAGE_ID,
} from '@/db/repos/libraryPages'
import { libraryRepo } from '@/db/repos/libraryTree'
import { appStateRepo } from '@/db/repos/session'
import { isSafeLegacyEmptyPlaceholder } from '@/features/library/legacyEmptyNodes'
import { PREVIOUS_LIBRARY_TITLE } from '@/features/library/libraryPageModel'
import { newId } from '@/lib/id'
import type { LibraryBlock, LibraryNode } from '@/types'

/**
 * One-time, idempotent import of the legacy study tree onto a Previous Library
 * *page* — not a toggle on the writing canvas.
 *
 * Safety rules:
 *  - Never clears IndexedDB and never deletes libraryNodes, notes, PDFs or books.
 *  - Skips blank leftover composer rows. A stored title of "Untitled" is real.
 *  - Empty containers are imported as Study blocks, not empty toggles.
 *  - The root Library page stays under the user's control.
 */

export const LIBRARY_PAGES_MIGRATION_KEY = 'libraryPagesMigrationVersion'
export const LIBRARY_PAGES_MIGRATION_VERSION = 2

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

  if (already === 1) {
    await promotePreviousLibraryToggle()
    await appStateRepo.set(LIBRARY_PAGES_MIGRATION_KEY, LIBRARY_PAGES_MIGRATION_VERSION)
    return { ran: true, imported: 0, skippedPlaceholders: 0 }
  }

  const result = await importLegacyOntoArchivePage()
  await appStateRepo.set(LIBRARY_PAGES_MIGRATION_KEY, LIBRARY_PAGES_MIGRATION_VERSION)
  return result
}

async function ensureArchivePage() {
  const existing = await db.libraryPages.get(PREVIOUS_LIBRARY_PAGE_ID)
  if (existing) return existing
  const now = Date.now()
  const page = {
    id: PREVIOUS_LIBRARY_PAGE_ID,
    title: PREVIOUS_LIBRARY_TITLE,
    parentPageId: ROOT_LIBRARY_PAGE_ID,
    createdAt: now,
    updatedAt: now,
  }
  await db.libraryPages.add(page)
  return page
}

async function ensureArchiveLink(pageId: string) {
  const roots = await db.libraryBlocks.where('pageId').equals(ROOT_LIBRARY_PAGE_ID).toArray()
  if (roots.some((block) => block.type === 'page' && block.targetPageId === pageId)) return
  const now = Date.now()
  const rest = roots.filter((block) => block.parentBlockId === null)
  await db.libraryBlocks.add({
    id: newId('lblk'),
    pageId: ROOT_LIBRARY_PAGE_ID,
    parentBlockId: null,
    type: 'page',
    content: PREVIOUS_LIBRARY_TITLE,
    order: 0,
    expanded: false,
    targetPageId: pageId,
    createdAt: now,
    updatedAt: now,
  })
  if (rest.length > 0) {
    await Promise.all(
      rest.map((block, index) =>
        db.libraryBlocks.update(block.id, { order: index + 1, updatedAt: now }),
      ),
    )
  }
}

async function promotePreviousLibraryToggle() {
  const archive = await ensureArchivePage()
  const blocks = await db.libraryBlocks.where('pageId').equals(ROOT_LIBRARY_PAGE_ID).toArray()
  const section = blocks.find(
    (block) => block.type === 'toggle' && block.content === PREVIOUS_LIBRARY_TITLE && !block.parentBlockId,
  )
  if (!section) {
    const existingPage = blocks.find(
      (block) => block.type === 'page' && block.content === PREVIOUS_LIBRARY_TITLE,
    )
    if (existingPage) return
    const hasStudy = blocks.some((block) => block.type === 'study')
    if (hasStudy) await ensureArchiveLink(archive.id)
    return
  }

  const descendants: typeof blocks = []
  const walk = (parentId: string) => {
    for (const row of blocks) {
      if (row.parentBlockId === parentId) {
        descendants.push(row)
        walk(row.id)
      }
    }
  }
  walk(section.id)
  if (descendants.length > 0) {
    const now = Date.now()
    await Promise.all(
      descendants.map((row) =>
        db.libraryBlocks.update(row.id, {
          pageId: archive.id,
          parentBlockId: row.parentBlockId === section.id ? null : row.parentBlockId,
          updatedAt: now,
        }),
      ),
    )
  }
  await db.libraryBlocks.update(section.id, {
    type: 'page',
    expanded: false,
    targetPageId: archive.id,
    content: PREVIOUS_LIBRARY_TITLE,
    updatedAt: Date.now(),
  })
}

async function importLegacyOntoArchivePage(): Promise<LibraryPagesMigrationResult> {
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
    return { ran: true, imported: 0, skippedPlaceholders }
  }

  const archive = await ensureArchivePage()
  const existing = await db.libraryBlocks.where('pageId').equals(archive.id).toArray()
  const alreadyLinked = new Set(
    existing.map((block) => block.libraryNodeId).filter((id): id is string => !!id),
  )
  if (importable.every((node) => alreadyLinked.has(node.id))) {
    await ensureArchiveLink(archive.id)
    return { ran: true, imported: 0, skippedPlaceholders }
  }

  const now = Date.now()
  await ensureArchiveLink(archive.id)

  const nodeIds = new Set(importable.map((node) => node.id))
  const blockIdByNode = new Map<string, string>()
  for (const node of importable) blockIdByNode.set(node.id, newId('lblk'))

  const parentBlockIdFor = (node: LibraryNode): string | null => {
    let parentId = node.parentId
    const seen = new Set<string>()
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      const mapped = blockIdByNode.get(parentId)
      if (mapped) return mapped
      parentId = nodes.find((row) => row.id === parentId)?.parentId ?? null
    }
    return null
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
        pageId: archive.id,
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
