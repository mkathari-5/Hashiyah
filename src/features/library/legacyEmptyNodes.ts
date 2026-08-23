import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import { isBlankTitle } from '@/features/library/libraryOutline'
import type { LibraryNode } from '@/types'

/**
 * Legacy empty-title handling.
 *
 * Old composers persisted blank rows (shown as “Untitled” by NodeTitle) the
 * moment you expanded a container. Those leftovers are not the same as a node
 * whose chosen title is the word “Untitled”.
 *
 * Safety rule: delete a blank-title node only when it is a leaf with no
 * children, no notes, no book/PDF, and no other user data (favourite, pages,
 * teacher, lesson number, or an open history). Anything with content is kept
 * as a recoverable blank row. The word “Untitled” as a stored title is kept.
 */

export function isChosenUntitledTitle(title: string | undefined | null): boolean {
  return title?.trim() === 'Untitled'
}

/** Blank latin + blank Arabic, excluding a deliberately named “Untitled”. */
export function isLegacyEmptyTitle(
  node: Pick<LibraryNode, 'title' | 'arabicTitle'>,
): boolean {
  if (isChosenUntitledTitle(node.title)) return false
  return isBlankTitle(node.title) && isBlankTitle(node.arabicTitle)
}

export function isSafeLegacyEmptyPlaceholder(node: LibraryNode, childCount: number): boolean {
  if (!isLegacyEmptyTitle(node)) return false
  if (childCount > 0) return false
  if (node.bookId) return false
  if (node.noteId) return false
  if (node.favorite) return false
  if (node.teacher) return false
  if (node.lessonNumber != null) return false
  if (node.pageStart != null || node.pageEnd != null) return false
  if (node.lastOpenedAt != null) return false
  return true
}

/** Idempotent: a second run finds nothing left that matches the safety rule. */
export async function purgeLegacyEmptyPlaceholders(): Promise<number> {
  const all = await libraryRepo.all()
  if (all.length === 0) return 0

  const childCount = new Map<string, number>()
  for (const node of all) {
    if (node.parentId) childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1)
  }

  let removed = 0
  for (const node of all) {
    if (!isSafeLegacyEmptyPlaceholder(node, childCount.get(node.id) ?? 0)) continue
    await db.libraryNodes.delete(node.id)
    removed += 1
  }
  return removed
}
