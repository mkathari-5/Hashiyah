import { anchorsRepo, annotationsRepo } from '@/db/repos/annotations'
import { documentsRepo } from '@/db/repos/documents'
import { booksRepo } from '@/db/repos/library'
import { noteDocsRepo } from '@/db/repos/notes'
import { pdfNoteLinksRepo } from '@/db/repos/pdfNoteLinks'
import { ids } from '@/lib/id'
import { AnnotationEngine } from '@/services/annotations/AnnotationEngine'
import {
  recordPdfNoteLinkCreated,
  recordPdfNoteLinkRemoved,
} from '@/services/annotations/history'
import type { CapturedSelection } from '@/services/annotations/selection'
import {
  applyLiveNoteDoc,
  flushLiveNote,
  insertSectionInLiveEditor,
  peekLiveNoteDoc,
  peekLiveNoteId,
} from '@/services/notes/liveNoteEditor'
import {
  blockExists,
  findBlockPreview,
  findBlockTitle,
  insertNamedToggleInDoc,
} from '@/services/notes/noteTargets'
import { saveNote } from '@/services/notes/NotesService'
import { defaultLabelPosition } from '@/services/notes/pdfNoteLinkGeometry'
import { useAppStore } from '@/state/useAppStore'
import { useLibraryStore } from '@/state/useLibraryStore'
import { useNotesStore } from '@/state/useNotesStore'
import { useStudyStore } from '@/state/useStudyStore'
import {
  PDF_NOTE_LINK_VERSION,
  type PdfNoteAnchorKind,
  type PdfNoteLabelMode,
  type PdfNoteLink,
  type TextSource,
} from '@/types'

export interface CreatePdfNoteLinkInput {
  bookId: string
  documentId: string
  capture: CapturedSelection
  textSource?: TextSource
  anchorKind: PdfNoteAnchorKind
  noteDocumentId: string
  noteBlockId: string
  libraryItemId?: string | null
  labelMode?: PdfNoteLabelMode
  customLabel?: string | null
  labelX?: number
  labelY?: number
}

export interface ResolvedPdfNoteLabel {
  link: PdfNoteLink
  title: string
  missingTarget: boolean
  preview: string
}

export const PdfNoteLinkEngine = {
  async create(input: CreatePdfNoteLinkInput): Promise<PdfNoteLink> {
    const textSource: TextSource =
      input.textSource ?? (input.anchorKind === 'text-selection' ? 'embedded' : 'none')
    const { annotation, anchor } = await AnnotationEngine.create({
      bookId: input.bookId,
      documentId: input.documentId,
      capture: input.capture,
      kind: 'noteLink',
      color: 'green',
      textSource,
    })
    const pos =
      input.labelX != null && input.labelY != null
        ? { x: input.labelX, y: input.labelY }
        : defaultLabelPosition(anchor.rects)
    const now = Date.now()
    const link: PdfNoteLink = {
      id: ids.pdfNoteLink(),
      version: PDF_NOTE_LINK_VERSION,
      annotationId: annotation.id,
      pdfDocumentId: input.documentId,
      pageNumber: input.capture.pageNumber,
      noteDocumentId: input.noteDocumentId,
      libraryItemId: input.libraryItemId ?? null,
      noteBlockId: input.noteBlockId,
      anchorKind: input.anchorKind,
      labelMode: input.labelMode ?? 'sync-with-note-title',
      customLabel: input.customLabel ?? null,
      labelX: pos.x,
      labelY: pos.y,
      colour: null,
      connectorVisible: true,
      createdAt: now,
      updatedAt: now,
    }
    await pdfNoteLinksRepo.put(link)
    recordPdfNoteLinkCreated(link, annotation, anchor)
    return link
  },

  get: (id: string) => pdfNoteLinksRepo.get(id),
  forPage: (pdfDocumentId: string, pageNumber: number) => pdfNoteLinksRepo.forPage(pdfDocumentId, pageNumber),
  forNote: (noteDocumentId: string) => pdfNoteLinksRepo.forNote(noteDocumentId),
  forBlock: (noteDocumentId: string, noteBlockId: string) =>
    pdfNoteLinksRepo.forBlock(noteDocumentId, noteBlockId),

  async update(id: string, patch: Partial<PdfNoteLink>): Promise<PdfNoteLink | null> {
    const current = await pdfNoteLinksRepo.get(id)
    if (!current) return null
    const next: PdfNoteLink = { ...current, ...patch, id: current.id, updatedAt: Date.now() }
    await pdfNoteLinksRepo.put(next)
    return next
  },

  async moveLabel(id: string, x: number, y: number): Promise<PdfNoteLink | null> {
    return PdfNoteLinkEngine.update(id, { labelX: x, labelY: y })
  },

  async setLabelMode(id: string, mode: PdfNoteLabelMode, customLabel?: string | null): Promise<PdfNoteLink | null> {
    return PdfNoteLinkEngine.update(id, {
      labelMode: mode,
      customLabel: mode === 'custom' ? (customLabel ?? '') : null,
    })
  },

  async relink(
    id: string,
    target: { noteDocumentId: string; noteBlockId: string; libraryItemId?: string | null },
  ): Promise<PdfNoteLink | null> {
    return PdfNoteLinkEngine.update(id, {
      noteDocumentId: target.noteDocumentId,
      noteBlockId: target.noteBlockId,
      libraryItemId: target.libraryItemId ?? null,
    })
  },

  /** Remove the relationship and PDF label. Never deletes the note. */
  async unlink(id: string): Promise<PdfNoteLink | null> {
    const link = await pdfNoteLinksRepo.get(id)
    if (!link) return null
    const annotation = await annotationsRepo.get(link.annotationId)
    const anchor = await anchorsRepo.forAnnotation(link.annotationId)
    await pdfNoteLinksRepo.remove(id)
    if (annotation) await AnnotationEngine.remove(link.annotationId)
    if (annotation && anchor) recordPdfNoteLinkRemoved(link, annotation, anchor)
    const study = useStudyStore.getState()
    if (study.selectedPdfNoteLinkId === id) study.setSelectedPdfNoteLinkId(null)
    return link
  },

  async unlinkMany(idsList: string[]): Promise<number> {
    let n = 0
    for (const id of idsList) {
      if (await PdfNoteLinkEngine.unlink(id)) n += 1
    }
    return n
  },

  async removeForNote(noteId: string): Promise<void> {
    const links = await pdfNoteLinksRepo.forNote(noteId)
    await PdfNoteLinkEngine.unlinkMany(links.map((l) => l.id))
  },

  async removeForBlocks(noteId: string, blockIds: string[]): Promise<number> {
    if (!blockIds.length) return 0
    const links = await pdfNoteLinksRepo.forBlocks(noteId, blockIds)
    return PdfNoteLinkEngine.unlinkMany(links.map((l) => l.id))
  },

  async countForBlocks(noteId: string, blockIds: string[]): Promise<number> {
    if (!blockIds.length) return 0
    const links = await pdfNoteLinksRepo.forBlocks(noteId, blockIds)
    return links.length
  },

  displayLabel(link: PdfNoteLink, liveTitle: string | null): { title: string; missingTarget: boolean } {
    if (link.labelMode === 'custom' && link.customLabel?.trim()) {
      return { title: link.customLabel.trim(), missingTarget: liveTitle === null }
    }
    if (liveTitle && liveTitle.trim()) return { title: liveTitle.trim(), missingTarget: false }
    return { title: 'Missing note', missingTarget: true }
  },

  async resolveLabel(link: PdfNoteLink): Promise<ResolvedPdfNoteLabel> {
    const stored = await noteDocsRepo.get(link.noteDocumentId)
    const liveDoc = peekLiveNoteDoc(link.noteDocumentId)
    const liveHas = liveDoc ? blockExists(liveDoc, link.noteBlockId) : false
    const storedHas = stored ? blockExists(stored.doc, link.noteBlockId) : false
    const doc = liveHas ? liveDoc : stored?.doc
    const missingTarget = !liveHas && !storedHas
    const liveTitle = doc && !missingTarget ? findBlockTitle(doc, link.noteBlockId) : null
    const { title } = PdfNoteLinkEngine.displayLabel(link, missingTarget ? null : liveTitle)
    const preview = doc && !missingTarget ? findBlockPreview(doc, link.noteBlockId) : ''
    return { link, title, missingTarget, preview }
  },

  async resolveForPage(pdfDocumentId: string, pageNumber: number): Promise<ResolvedPdfNoteLabel[]> {
    const links = await pdfNoteLinksRepo.forPage(pdfDocumentId, pageNumber)
    return Promise.all(links.map((link) => PdfNoteLinkEngine.resolveLabel(link)))
  },

  /**
   * Open the target note without moving the PDF. Library highlight is visual
   * only — it must not call `openNode`, which would reset the page.
   */
  async revealNote(link: PdfNoteLink): Promise<void> {
    const app = useAppStore.getState()
    if (app.layout === 'pdf') app.setLayout('study')

    if (link.libraryItemId) {
      await useLibraryStore.getState().highlightNode(link.libraryItemId)
    }

    const study = useStudyStore.getState()
    if (study.activeNoteId !== link.noteDocumentId) {
      study.setActiveNote(link.noteDocumentId)
    }
    useNotesStore.getState().requestScrollTo(link.noteDocumentId, link.noteBlockId)
  },

  /** Reverse: return the PDF to the stored page and pulse the source region. */
  async jumpToSource(link: PdfNoteLink): Promise<'ok' | 'missing-pdf'> {
    const doc = await documentsRepo.get(link.pdfDocumentId)
    if (!doc) return 'missing-pdf'
    const study = useStudyStore.getState()
    if (study.bookId !== doc.bookId) {
      await study.openBook(doc.bookId)
    }
    const after = useStudyStore.getState()
    if (after.documentId !== link.pdfDocumentId) {
      after.setDocumentId(link.pdfDocumentId)
    }
    const app = useAppStore.getState()
    if (app.layout === 'notes') app.setLayout('study')
    after.requestJump(link.annotationId)
    return 'ok'
  },

  async createNamedSection(input: {
    noteId: string
    title: string
    parentBlockId?: string | null
  }): Promise<string> {
    const blockId = ids.block()
    if (peekLiveNoteId() === input.noteId) {
      const ok = insertSectionInLiveEditor({
        noteId: input.noteId,
        title: input.title,
        parentBlockId: input.parentBlockId,
        blockId,
      })
      if (ok) {
        await flushLiveNote(input.noteId)
        return blockId
      }
    }

    const stored = await noteDocsRepo.get(input.noteId)
    const base = peekLiveNoteDoc(input.noteId) ?? stored?.doc ?? { type: 'doc', content: [] }
    const next = insertNamedToggleInDoc(base, {
      title: input.title,
      parentBlockId: input.parentBlockId,
      blockId,
    })
    await saveNote(input.noteId, next)
    applyLiveNoteDoc(input.noteId, next)
    return blockId
  },

  async sourceChipLabel(link: PdfNoteLink): Promise<{
    text: string
    missingPdf: boolean
    selectedText: string
  }> {
    const doc = await documentsRepo.get(link.pdfDocumentId)
    const book = doc ? await booksRepo.get(doc.bookId) : null
    const annotation = await annotationsRepo.get(link.annotationId)
    const bookName = book?.title || book?.arabicTitle || 'PDF'
    if (!doc) {
      return { text: 'PDF unavailable', missingPdf: true, selectedText: annotation?.selectedText ?? '' }
    }
    return {
      text: `Source: ${bookName} · p. ${link.pageNumber}`,
      missingPdf: false,
      selectedText: annotation?.selectedText ?? '',
    }
  },
}

export { defaultLabelPosition }
