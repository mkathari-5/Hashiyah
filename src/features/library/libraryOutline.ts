import type { LibraryNode, LibraryNodeType } from '@/types'

/**
 * Structural rules for Notion-like outline editing over real LibraryNodes.
 *
 * ── The shape of the library ──────────────────────────────────────────────
 *
 * Above a book, structure is meaningful: a science holds books, not verses.
 * *Below* a book it is not. A bāb, a condition, a question, an ustādh's
 * explanation and a single point within it are all just study items, and which
 * one you are looking at is a matter of where it sits, not what it is. So
 * everything under a book is one generic item type that can always contain
 * more of itself, without limit.
 *
 * `chapter` remains the stored discriminator for that generic item purely so
 * no existing node has to be rewritten — every chapter already in the database
 * simply becomes an item that can now hold children. Nothing user-facing says
 * "chapter"; see `ITEM_LABEL`.
 */

/** What a study item is called in the interface. Never "chapter". */
export const ITEM_LABEL = 'item'

/** The generic study item stored type. Deliberately unchanged from v1 data. */
export const STUDY_ITEM: LibraryNodeType = 'chapter'

/** Types that live above a book and organise it. */
const ORGANISERS: LibraryNodeType[] = ['science', 'folder', 'book', 'course']

/** Types that are study items below a book. */
const STUDY_ITEMS: LibraryNodeType[] = ['chapter', 'lesson', 'notes']

export function isContainerType(type: LibraryNodeType): boolean {
  return ORGANISERS.includes(type)
}

export function isStudyItemType(type: LibraryNodeType): boolean {
  return STUDY_ITEMS.includes(type)
}

/**
 * Default child type when pressing + / Enter under a parent.
 *
 * Never null: there is no node at which the hierarchy stops. Previously
 * `lesson` and `notes` returned null — dead ends with no `+` and no composer —
 * which together with the drop rule produced the Science → Book → Chapter →
 * stop ceiling.
 */
export function childTypeFor(parentType: LibraryNodeType): LibraryNodeType | null {
  if (parentType === 'science' || parentType === 'folder') return 'book'
  // Everything from a book downwards continues as a generic study item.
  return STUDY_ITEM
}

/** Whether `childType` may sit directly under a parent of `parentType`. */
export function canNestUnder(childType: LibraryNodeType, parentType: LibraryNodeType): boolean {
  if (parentType === 'science' || parentType === 'folder') {
    return childType === 'book' || childType === 'course' || childType === 'folder' || childType === 'notes'
  }
  // A book, a course, or any study item: all take study items, to any depth.
  return isStudyItemType(childType)
}

/** Whether a node may sit at the root of the library. */
export function canSitAtRoot(type: LibraryNodeType): boolean {
  return type === 'science' || type === 'folder' || type === 'book'
}

export function isBlankTitle(title: string | undefined | null): boolean {
  return !title?.trim()
}

/** Previous sibling in the same parent, or null. */
export function previousSibling(node: LibraryNode, siblings: LibraryNode[]): LibraryNode | null {
  const ordered = [...siblings].sort((a, b) => a.order - b.order)
  const index = ordered.findIndex((n) => n.id === node.id)
  if (index <= 0) return null
  return ordered[index - 1] ?? null
}
