import { db } from '@/db/db'
import { libraryBlocksRepo } from '@/db/repos/libraryPages'
import { libraryRepo } from '@/db/repos/libraryTree'
import { useLibraryStore } from '@/state/useLibraryStore'
import { useStudyStore } from '@/state/useStudyStore'
import type { LibraryBlock, LibraryNode, Note, NoteDoc, NoteLink, QuoteRef } from '@/types'

export interface DeleteImpact {
  id: string
  title: string
  nestedCount: number
  hasNotes: boolean
  hasPdf: boolean
  hasCaptures: boolean
  hasContent: boolean
  needsConfirm: boolean
  summary: string
  detail: string
}

export interface NodeDeleteSnapshot {
  nodes: LibraryNode[]
  notes: Note[]
  docs: NoteDoc[]
  quoteRefs: QuoteRef[]
  noteLinks: NoteLink[]
  selectAfter: string | null
}

export interface BlockDeleteSnapshot {
  blocks: LibraryBlock[]
  selectAfter: string | null
}

function displayTitle(title: string): string {
  return title.trim() || 'Untitled'
}

export async function inspectNodeDeletion(id: string): Promise<DeleteImpact | null> {
  const node = await libraryRepo.get(id)
  if (!node) return null
  const descendants = await libraryRepo.descendants(id)
  const all = [node, ...descendants]
  const noteIds = all.map((row) => row.noteId).filter((value): value is string => !!value)
  const notes = (
    await Promise.all(noteIds.map((noteId) => db.notes.get(noteId)))
  ).filter((row): row is Note => !!row)
  const docs = (
    await Promise.all(noteIds.map((noteId) => db.noteDocs.get(noteId)))
  ).filter((row): row is NoteDoc => !!row)
  const quoteCounts = await Promise.all(noteIds.map((noteId) => db.quoteRefs.where('noteId').equals(noteId).count()))
  const hasNotes = notes.length > 0
  const hasPdf = all.some((row) => !!row.bookId)
  const hasCaptures = quoteCounts.some((count) => count > 0) || docs.some((doc) => {
    if (!doc || typeof doc.doc !== 'object' || !doc.doc) return false
    return JSON.stringify(doc.doc).includes('sourceQuote')
  })
  const hasContent = hasNotes || hasPdf || hasCaptures || descendants.length > 0 || !!node.title.trim()
  const nestedCount = descendants.length
  const title = displayTitle(node.title)
  const summary =
    nestedCount > 0
      ? `Delete “${title}” and its ${nestedCount} nested item${nestedCount === 1 ? '' : 's'}?`
      : `Delete “${title}”?`
  const bits = ['Their notes will be deleted.']
  if (hasPdf) bits.push('The PDF itself is kept.')
  if (hasCaptures) bits.push('Source excerpts stored in those notes will be removed with them.')
  return {
    id,
    title,
    nestedCount,
    hasNotes,
    hasPdf,
    hasCaptures,
    hasContent,
    needsConfirm: nestedCount > 0 || hasNotes || hasPdf || hasCaptures,
    summary,
    detail: bits.join(' '),
  }
}

export async function inspectBlockDeletion(id: string): Promise<DeleteImpact | null> {
  const block = await libraryBlocksRepo.get(id)
  if (!block) return null
  const descendants = await libraryBlocksRepo.descendants(id)
  const nestedCount = descendants.length
  const hasContent = !!(block.content.trim() || block.libraryNodeId || block.targetPageId || nestedCount)
  const title = displayTitle(block.content)
  const summary =
    nestedCount > 0
      ? `Delete “${title}” and its ${nestedCount} nested item${nestedCount === 1 ? '' : 's'}?`
      : `Delete “${title}”?`
  return {
    id,
    title,
    nestedCount,
    hasNotes: false,
    hasPdf: false,
    hasCaptures: false,
    hasContent,
    needsConfirm: nestedCount > 0 || hasContent,
    summary,
    detail: nestedCount > 0 ? 'Nested library rows on this page will be removed.' : 'This row will be removed from the Library page.',
  }
}

export async function snapshotNodeDeletion(id: string): Promise<NodeDeleteSnapshot | null> {
  const node = await libraryRepo.get(id)
  if (!node) return null
  const descendants = await libraryRepo.descendants(id)
  const nodes = [node, ...descendants]
  const noteIds = nodes.map((row) => row.noteId).filter((value): value is string => !!value)
  const notes = (
    await Promise.all(noteIds.map((noteId) => db.notes.get(noteId)))
  ).filter((row): row is Note => !!row)
  const docs = (
    await Promise.all(noteIds.map((noteId) => db.noteDocs.get(noteId)))
  ).filter((row): row is NoteDoc => !!row)
  const quoteRefs: QuoteRef[] = []
  const noteLinks: NoteLink[] = []
  for (const noteId of noteIds) {
    quoteRefs.push(...(await db.quoteRefs.where('noteId').equals(noteId).toArray()))
    noteLinks.push(...(await db.noteLinks.where('sourceNoteId').equals(noteId).toArray()))
  }
  const siblings = await libraryRepo.children(node.parentId)
  const index = siblings.findIndex((row) => row.id === id)
  const selectAfter = siblings[index + 1]?.id ?? siblings[index - 1]?.id ?? node.parentId
  return { nodes, notes, docs, quoteRefs, noteLinks, selectAfter }
}

export async function restoreNodeDeletion(snapshot: NodeDeleteSnapshot): Promise<void> {
  await db.transaction('rw', db.libraryNodes, db.notes, db.noteDocs, db.quoteRefs, db.noteLinks, async () => {
    await db.libraryNodes.bulkPut(snapshot.nodes)
    if (snapshot.notes.length) await db.notes.bulkPut(snapshot.notes)
    if (snapshot.docs.length) await db.noteDocs.bulkPut(snapshot.docs)
    if (snapshot.quoteRefs.length) await db.quoteRefs.bulkPut(snapshot.quoteRefs)
    if (snapshot.noteLinks.length) await db.noteLinks.bulkPut(snapshot.noteLinks)
  })
}

export async function deleteLibraryNode(id: string): Promise<NodeDeleteSnapshot | null> {
  const snapshot = await snapshotNodeDeletion(id)
  if (!snapshot) return null
  await libraryRepo.remove(id)
  const library = useLibraryStore.getState()
  if (library.activeNodeId && snapshot.nodes.some((node) => node.id === library.activeNodeId)) {
    if (!snapshot.selectAfter) library.showLibrary()
    else {
      const next = await libraryRepo.get(snapshot.selectAfter)
      if (!next) library.showLibrary()
      else if (next.type === 'science' || next.type === 'folder') {
        useLibraryStore.setState({ activeNodeId: next.id })
      } else {
        await library.openNode(snapshot.selectAfter)
      }
    }
  }
  const study = useStudyStore.getState()
  const removedNotes = new Set(snapshot.notes.map((note) => note.id))
  if (study.activeNoteId && removedNotes.has(study.activeNoteId)) {
    const next = snapshot.selectAfter ? await libraryRepo.get(snapshot.selectAfter) : null
    study.setActiveNote(next?.noteId ?? null)
  }
  return snapshot
}

export async function snapshotBlockDeletion(id: string): Promise<BlockDeleteSnapshot | null> {
  const block = await libraryBlocksRepo.get(id)
  if (!block) return null
  const descendants = await libraryBlocksRepo.descendants(id)
  const siblings = await libraryBlocksRepo.children(block.pageId, block.parentBlockId)
  const index = siblings.findIndex((row) => row.id === id)
  const selectAfter = siblings[index + 1]?.id ?? siblings[index - 1]?.id ?? block.parentBlockId
  return { blocks: [block, ...descendants], selectAfter }
}

export async function restoreBlockDeletion(snapshot: BlockDeleteSnapshot): Promise<void> {
  await db.libraryBlocks.bulkPut(snapshot.blocks)
}

export async function deleteLibraryBlock(id: string): Promise<BlockDeleteSnapshot | null> {
  const snapshot = await snapshotBlockDeletion(id)
  if (!snapshot) return null
  await libraryBlocksRepo.remove(id)
  return snapshot
}
