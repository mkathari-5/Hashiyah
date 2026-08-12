import type { LibraryNode, LibraryNodeType } from '@/types'

/**
 * Structural rules for Notion-like outline editing over real LibraryNodes.
 *
 * Tab/indent must not invent impossible trees (e.g. a Book under a Chapter).
 */

const CONTAINERS: LibraryNodeType[] = ['science', 'folder', 'book', 'course']

export function isContainerType(type: LibraryNodeType): boolean {
  return CONTAINERS.includes(type)
}

/** Default child type when pressing + / Enter under a parent. */
export function childTypeFor(parentType: LibraryNodeType): LibraryNodeType | null {
  if (parentType === 'science' || parentType === 'folder') return 'book'
  if (parentType === 'book' || parentType === 'course') return 'chapter'
  // Nested chapters — outline sections under a chapter.
  if (parentType === 'chapter') return 'chapter'
  return null
}

/** Whether `childType` may sit directly under a parent of `parentType`. */
export function canNestUnder(childType: LibraryNodeType, parentType: LibraryNodeType): boolean {
  if (parentType === 'science' || parentType === 'folder') {
    return childType === 'book' || childType === 'course' || childType === 'folder' || childType === 'notes'
  }
  if (parentType === 'book' || parentType === 'course') {
    return childType === 'chapter' || childType === 'lesson' || childType === 'notes'
  }
  if (parentType === 'chapter') {
    return childType === 'chapter' || childType === 'notes'
  }
  return false
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
