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

/** The first position inside a toggle's title, given the toggle's own position. */
export function toggleTitlePos(togglePos: number): number {
  return togglePos + 2
}

export function insertSiblingToggle(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  level?: number,
): boolean {
  const found = findToggle(state)
  if (!found) return false
  const after = found.pos + found.node.nodeSize
  const next = emptyToggleShell(state.schema, level ?? Number(found.node.attrs.level ?? 0))
  const tr = state.tr.insert(after, next)
  tr.setSelection(TextSelection.near(tr.doc.resolve(toggleTitlePos(after)), 1)).scrollIntoView()
  if (dispatch) dispatch(tr)
  return true
}

/**
 * Put a fresh toggle at the caret.
 *
 * The old version replaced `selection.from … selection.to` whenever the caret
 * was not in an empty paragraph, which meant a `/toggle` typed inside a toggle
 * *title* asked ProseMirror to fit a block node into inline content. The fitting
 * algorithm split the surrounding toggle to make room and the reader was left
 * with three toggles where they asked for one.
 *
 * So the position is now chosen by the schema rather than assumed: walk out
 * from the caret until a parent is found that can actually hold a toggle,
 * replacing the current block when it is empty and inserting after it when it
 * is not. Nothing is ever fitted into a context that forbids it.
 */
export function insertToggleAtCaret(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  level = 0,
): boolean {
  const type = state.schema.nodes.toggleBlock
  const { $from } = state.selection

  // Already sitting in the title of an empty toggle: that *is* the toggle being
  // asked for, so reuse it rather than leaving a discarded shell behind.
  const inTitle = $from.parent.type.name === 'toggleSummary'
  if (inTitle) {
    const found = findToggle(state)
    if (found && isEmptyToggle(found.node)) {
      if (Number(found.node.attrs.level ?? 0) !== level && dispatch) {
        dispatch(state.tr.setNodeAttribute(found.pos, 'level', level))
      }
      return true
    }
  }

  const node = emptyToggleShell(state.schema, level)

  for (let depth = $from.depth; depth > 0; depth--) {
    const parent = $from.node(depth - 1)
    const index = $from.index(depth - 1)
    const block = $from.node(depth)

    const replacing = block.content.size === 0 && parent.canReplaceWith(index, index + 1, type)
    const inserting = !replacing && parent.canReplaceWith(index + 1, index + 1, type)
    if (!replacing && !inserting) continue

    const at = replacing ? $from.before(depth) : $from.after(depth)
    let tr = replacing ? state.tr.replaceWith(at, $from.after(depth), node) : state.tr.insert(at, node)
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(toggleTitlePos(at)), 1)).scrollIntoView()
    if (dispatch) dispatch(tr)
    return true
  }

  return false
}

/**
 * Turn the block at the caret into a toggle, keeping its text as the title.
 *
 * A block that is already a toggle title is left alone — converting it again
 * used to replace the title with a whole toggle node, which the schema cannot
 * hold and which ProseMirror resolved by shredding the toggle into three.
 */
export function wrapBlockInToggle(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  level = 0,
): boolean {
  const { $from } = state.selection
  const depth = $from.depth
  const block = $from.node(depth)
  if (!block.isTextblock) return false

  if (block.type.name === 'toggleSummary') {
    const found = findToggle(state)
    if (!found) return false
    if (Number(found.node.attrs.level ?? 0) !== level && dispatch) {
      dispatch(state.tr.setNodeAttribute(found.pos, 'level', level))
    }
    return true
  }

  const { schema } = state
  const type = schema.nodes.toggleBlock
  const parent = $from.node(depth - 1)
  const index = $from.index(depth - 1)
  if (!parent.canReplaceWith(index, index + 1, type)) {
    return insertToggleAtCaret(state, dispatch, level)
  }

  const node = type.create({ open: true, level }, [
    schema.nodes.toggleSummary.create(null, block.content),
    schema.nodes.toggleContent.create(null, schema.nodes.paragraph.create()),
  ])
  const from = $from.before(depth)
  let tr = state.tr.replaceWith(from, $from.after(depth), node)
  // The title is already written, so the caret belongs in the body.
  const bodyStart = from + 1 + node.child(0).nodeSize + 1
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(bodyStart), 1)).scrollIntoView()
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

/**
 * Enter on the last empty paragraph of a toggle body → out of the toggle.
 *
 * This is the way back to ordinary prose. It used to create another sibling
 * toggle, which meant Enter could get you into a toggle but never out of one:
 * every empty line turned into one more question. Rapid consecutive toggles are
 * Shift+Enter, which is a deliberate keystroke rather than the default one.
 */
export function exitToggleBody(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size > 0) {
    return false
  }
  if ($from.depth < 2) return false
  const body = $from.node(-1)
  if (body.type.name !== 'toggleContent') return false
  if ($from.index(-1) !== body.childCount - 1) return false

  const toggleDepth = $from.depth - 2
  const toggleEnd = $from.after(toggleDepth)

  // Land in the paragraph that already follows, when there is an empty one —
  // otherwise every exit at the end of a note leaves a spare blank line behind.
  const container = $from.node(toggleDepth - 1)
  const next = container.maybeChild($from.index(toggleDepth - 1) + 1)
  const reuse = next?.type.name === 'paragraph' && next.content.size === 0

  let tr = state.tr
  // Take the empty line with us — unless it is the body's only block, since
  // `toggleContent` is `block+` and may not be emptied.
  if (body.childCount > 1) tr = tr.delete($from.before(), $from.after())

  const at = tr.mapping.map(toggleEnd)
  if (!reuse) tr = tr.insert(at, state.schema.nodes.paragraph.create())
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1), 1)).scrollIntoView()
  if (dispatch) dispatch(tr)
  return true
}
