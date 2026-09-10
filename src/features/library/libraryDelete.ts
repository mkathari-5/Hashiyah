import { db } from '@/db/db'
import { libraryBlocksRepo } from '@/db/repos/libraryPages'
import { libraryRepo } from '@/db/repos/libraryTree'
import { useLibraryStore } from '@/state/useLibraryStore'
import { useStudyStore } from '@/state/useStudyStore'
import type { Annotation, AnnotationAnchor, LibraryBlock, LibraryNode, Note, NoteDoc, NoteLink, PdfNoteLink, QuoteRef } from '@/types'

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
  pdfNoteLinks: PdfNoteLink[]
  linkAnnotations: Annotation[]
  linkAnchors: AnnotationAnchor[]
  selectAfter: string | null
}

export interface BlockDeleteSnapshot {
  blocks: LibraryBlock[]
  selectAfter: string | null
}

const SUBSTANTIAL_NODE_TYPES = new Set([
  'sourceQuote',
  'imageBlock',
  'image',
  'quranBlock',
  'hadithBlock',
  'table',
])

/** True when a Tiptap document holds more than an empty paragraph shell. */
export function tiptapDocHasSubstance(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false
  const walk = (node: Record<string, unknown>): boolean => {
    const type = node.type
    if (typeof type === 'string' && SUBSTANTIAL_NODE_TYPES.has(type)) return true
    if (typeof node.text === 'string' && node.text.trim().length > 0) return true
    const content = node.content
    if (!Array.isArray(content)) return false
    return content.some((child) => child && typeof child === 'object' && walk(child as Record<string, unknown>))
  }
  return walk(doc as Record<string, unknown>)
}

export function displayLibraryTitle(latin?: string | null, arabic?: string | null): string {
  return (latin ?? '').trim() || (arabic ?? '').trim() || 'this item'
}

function deletionDetail(flags: { hasNotes: boolean; hasPdf: boolean; hasCaptures: boolean; nestedCount: number }): string {
  const bits: string[] = []
  if (flags.hasNotes) bits.push('Their notes will be deleted.')
  if (flags.hasPdf) bits.push('The PDF itself is kept.')
  if (flags.hasCaptures) bits.push('Source excerpts and PDF linked labels stored with those notes will be removed with them.')
  if (flags.nestedCount > 0 && bits.length === 0) bits.push('Nested items will be removed.')
  return bits.join(' ')
}

export async function inspectNodeDeletion(id: string): Promise<DeleteImpact | null> {
  const node = await libraryRepo.get(id)
  if (!node) return null
  const descendants = await libraryRepo.descendants(id)
  const all = [node, ...descendants]
  const noteIds = all.map((row) => row.noteId).filter((value): value is string => !!value)
  const docs = (
    await Promise.all(noteIds.map((noteId) => db.noteDocs.get(noteId)))
  ).filter((row): row is NoteDoc => !!row)
  const quoteCounts = await Promise.all(noteIds.map((noteId) => db.quoteRefs.where('noteId').equals(noteId).count()))
  const linkCounts = await Promise.all(noteIds.map((noteId) => db.pdfNoteLinks.where('noteDocumentId').equals(noteId).count()))
  const hasNotes = docs.some((doc) => tiptapDocHasSubstance(doc.doc))
  const hasPdf = all.some((row) => !!row.bookId)
  const hasCaptures =
    quoteCounts.some((count) => count > 0) ||
    linkCounts.some((count) => count > 0) ||
    docs.some((doc) => typeof doc.doc === 'object' && doc.doc && JSON.stringify(doc.doc).includes('sourceQuote'))
  const nestedCount = descendants.length
  const hasContent = hasNotes || hasPdf || hasCaptures || nestedCount > 0 || !!node.title.trim() || !!node.arabicTitle?.trim()
  const title = displayLibraryTitle(node.title, node.arabicTitle)
  const summary =
    nestedCount > 0
      ? `Delete “${title}” and its ${nestedCount} nested item${nestedCount === 1 ? '' : 's'}?`
      : `Delete “${title}”?`
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
    detail: deletionDetail({ hasNotes, hasPdf, hasCaptures, nestedCount }),
  }
}

export async function inspectBlockDeletion(id: string): Promise<DeleteImpact | null> {
  const block = await libraryBlocksRepo.get(id)
  if (!block) return null
  const descendants = await libraryBlocksRepo.descendants(id)
  const nestedCount = descendants.length
  const linked = !!(block.libraryNodeId || block.targetPageId)
  const hasContent = !!(block.content.trim() || linked || nestedCount)
  const title = displayLibraryTitle(block.content)
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
    needsConfirm: nestedCount > 0 || linked,
    summary,
    detail:
      nestedCount > 0
        ? 'Nested library rows on this page will be removed.'
        : linked
          ? 'This row is linked to a study item or page.'
          : '',
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
  const pdfNoteLinks: PdfNoteLink[] = []
  for (const noteId of noteIds) {
    quoteRefs.push(...(await db.quoteRefs.where('noteId').equals(noteId).toArray()))
    noteLinks.push(...(await db.noteLinks.where('sourceNoteId').equals(noteId).toArray()))
    pdfNoteLinks.push(...(await db.pdfNoteLinks.where('noteDocumentId').equals(noteId).toArray()))
  }
  const linkAnnotations: Annotation[] = []
  const linkAnchors: AnnotationAnchor[] = []
  for (const link of pdfNoteLinks) {
    const annotation = await db.annotations.get(link.annotationId)
    const anchor = await db.anchors.where('annotationId').equals(link.annotationId).first()
    if (annotation) linkAnnotations.push(annotation)
    if (anchor) linkAnchors.push(anchor)
  }
  const siblings = await libraryRepo.children(node.parentId)
  const index = siblings.findIndex((row) => row.id === id)
  const selectAfter = siblings[index + 1]?.id ?? siblings[index - 1]?.id ?? node.parentId
  return { nodes, notes, docs, quoteRefs, noteLinks, pdfNoteLinks, linkAnnotations, linkAnchors, selectAfter }
}

export async function restoreNodeDeletion(snapshot: NodeDeleteSnapshot): Promise<void> {
  await db.transaction(
    'rw',
    [db.libraryNodes, db.notes, db.noteDocs, db.quoteRefs, db.noteLinks, db.pdfNoteLinks, db.annotations, db.anchors],
    async () => {
      await db.libraryNodes.bulkPut(snapshot.nodes)
      if (snapshot.notes.length) await db.notes.bulkPut(snapshot.notes)
      if (snapshot.docs.length) await db.noteDocs.bulkPut(snapshot.docs)
      if (snapshot.quoteRefs.length) await db.quoteRefs.bulkPut(snapshot.quoteRefs)
      if (snapshot.noteLinks.length) await db.noteLinks.bulkPut(snapshot.noteLinks)
      if (snapshot.linkAnnotations.length) await db.annotations.bulkPut(snapshot.linkAnnotations)
      if (snapshot.linkAnchors.length) await db.anchors.bulkPut(snapshot.linkAnchors)
      if (snapshot.pdfNoteLinks.length) await db.pdfNoteLinks.bulkPut(snapshot.pdfNoteLinks)
    },
  )
}

function isOrganiser(type: LibraryNode['type']): boolean {
  return type === 'science' || type === 'folder'
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
      if (!next || isOrganiser(next.type)) {
        useStudyStore.getState().closeBook()
        library.showLibrary()
      } else {
        await library.openNode(snapshot.selectAfter)
      }
    }
  }
  const study = useStudyStore.getState()
  const removedNotes = new Set(snapshot.notes.map((note) => note.id))
  if (study.activeNoteId && removedNotes.has(study.activeNoteId)) {
    const next = snapshot.selectAfter ? await libraryRepo.get(snapshot.selectAfter) : null
    if (!next || isOrganiser(next.type)) study.setActiveNote(null)
    else study.setActiveNote(next.noteId ?? null)
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
