import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Keyboard outline operations for toggle blocks.
 *
 * Kept free of React node views so the rules can be unit-tested against a plain
 * ProseMirror document.
 */

export type ToggleHit = { node: PMNode; pos: number; depth: number }

export function findToggle(state: EditorState): ToggleHit | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'toggleBlock') {
      return { node: $from.node(depth), pos: $from.before(depth), depth }
    }
  }
  return null
}

export function emptyToggleShell(schema: EditorState['schema'], level = 0): PMNode {
  return schema.nodes.toggleBlock.create({ open: true, level }, [
    schema.nodes.toggleSummary.create(),
    schema.nodes.toggleContent.create(null, schema.nodes.paragraph.create()),
  ])
}

/** True when the toggle has no title text and only a single empty paragraph body. */
export function isEmptyToggle(node: PMNode): boolean {
  if (node.type.name !== 'toggleBlock') return false
  const summary = node.child(0)
  const content = node.child(1)
  if (summary.textContent.trim().length > 0) return false
  if (content.childCount !== 1) return false
  const only = content.child(0)
  return only.type.name === 'paragraph' && only.content.size === 0
}

export function insertSiblingToggle(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const found = findToggle(state)
  if (!found) return false
  const after = found.pos + found.node.nodeSize
  const level = Number(found.node.attrs.level ?? 0)
  const next = emptyToggleShell(state.schema, level)
  const tr = state.tr.insert(after, next)
  tr.setSelection(TextSelection.near(tr.doc.resolve(after + 2), 1)).scrollIntoView()
  if (dispatch) dispatch(tr)
  return true
}

export function nestUnderPreviousToggle(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const found = findToggle(state)
  if (!found) return false
  const $pos = state.doc.resolve(found.pos)
  const parentDepth = found.depth - 1
  if (parentDepth < 0) return false
  const index = $pos.index(parentDepth)
  if (index <= 0) return false
  const parent = $pos.node(parentDepth)
  const prev = parent.child(index - 1)
  if (prev.type.name !== 'toggleBlock') return false

  const prevPos = found.pos - prev.nodeSize
  const summarySize = prev.child(0).nodeSize
  const insertPos = prevPos + 1 + summarySize + 1 + prev.child(1).content.size

  let tr = state.tr
  const moving = found.node
  tr = tr.delete(found.pos, found.pos + found.node.nodeSize)
  tr = tr.insert(insertPos, moving)
  tr = tr.setNodeAttribute(prevPos, 'open', true)
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 2), 1)).scrollIntoView()
  if (dispatch) dispatch(tr)
  return true
}

export function outdentToggle(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const found = findToggle(state)
  if (!found || found.depth < 2) return false
  const $pos = state.doc.resolve(found.pos)
  if ($pos.node(found.depth - 1).type.name !== 'toggleContent') return false
  if ($pos.node(found.depth - 2).type.name !== 'toggleBlock') return false

  const parentToggleDepth = found.depth - 2
  const parentTogglePos = $pos.before(parentToggleDepth)
  const parentToggle = $pos.node(parentToggleDepth)
  const insertAfter = parentTogglePos + parentToggle.nodeSize

  let tr = state.tr
  const moving = found.node
  tr = tr.delete(found.pos, found.pos + found.node.nodeSize)
  const dest = insertAfter - moving.nodeSize
  tr = tr.insert(dest, moving)
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(dest + 2), 1)).scrollIntoView()
  if (dispatch) dispatch(tr)
  return true
}

export function deleteEmptyToggle(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const found = findToggle(state)
  if (!found || !isEmptyToggle(found.node)) return false
  const from = found.pos
  const to = found.pos + found.node.nodeSize
  let tr = state.tr.delete(from, to)
  const sel = Math.max(1, Math.min(from, tr.doc.content.size))
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(sel), -1)).scrollIntoView()
  if (dispatch) dispatch(tr)
  return true
}

/** Enter on the last empty paragraph of a toggle body → next sibling toggle. */
export function enterFromEmptyBody(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size > 0) {
    return false
  }
  if ($from.depth < 2 || $from.node(-1).type.name !== 'toggleContent') return false
  if ($from.index(-1) !== $from.node(-1).childCount - 1) return false
  return insertSiblingToggle(state, dispatch)
}
