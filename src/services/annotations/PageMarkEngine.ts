import { DEFAULT_TEXT_COLOR } from '@/services/annotations/appearance'
import { pageMarksRepo } from '@/db/repos/pageMarks'
import { ids } from '@/lib/id'
import { isMarginRect } from '@/services/pdf/pageCoords'
import type { NormalizedRect, PageMark, PageMarkKind, PageMarkStyle } from '@/types'

export const DEFAULT_MARK_STYLE: PageMarkStyle = {
  fontSize: 14,
  color: DEFAULT_TEXT_COLOR,
  direction: 'auto',
  align: 'start',
  fillColor: '#fffde7',
  fillOpacity: 0,
  strokeColor: DEFAULT_TEXT_COLOR,
  strokeWidth: 0,
}

export const MARK_COLORS = [DEFAULT_TEXT_COLOR, '#6b5344', '#8a6a3b', '#3f5d4a', '#3d5a73', '#7a4a48', '#5c4d73'] as const

export const MARK_SIZES = [12, 14, 15, 18, 22, 28, 36]

export const MARK_FONTS: { id: NonNullable<PageMarkStyle['fontFamily']>; label: string }[] = [
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'arabic', label: 'Arabic' },
]

export interface CreateMarkInput {
  bookId: string
  documentId: string
  pageNumber: number
  kind?: PageMarkKind
  rect: NormalizedRect
  content?: string
  style?: Partial<PageMarkStyle>
  pageRotation?: number
  pageWidth: number
  pageHeight: number
  annotationId?: string | null
}

export const PageMarkEngine = {
  async create(input: CreateMarkInput): Promise<PageMark> {
    const now = Date.now()
    const kind = input.kind ?? (isMarginRect(input.rect) ? 'margin' : 'text')
    const mark: PageMark = {
      id: ids.pageMark(),
      bookId: input.bookId,
      documentId: input.documentId,
      pageNumber: input.pageNumber,
      kind,
      rect: input.rect,
      content: input.content ?? '',
      style: { ...DEFAULT_MARK_STYLE, ...input.style },
      pageRotation: input.pageRotation ?? 0,
      pageWidth: input.pageWidth,
      pageHeight: input.pageHeight,
      annotationId: input.annotationId ?? null,
      createdAt: now,
      updatedAt: now,
    }
    await pageMarksRepo.put(mark)
    return mark
  },

  async update(id: string, patch: Partial<Pick<PageMark, 'rect' | 'content' | 'style' | 'kind'>>): Promise<PageMark | undefined> {
    const current = await pageMarksRepo.get(id)
    if (!current) return
    const next: PageMark = {
      ...current,
      ...patch,
      style: patch.style ? { ...current.style, ...patch.style } : current.style,
      updatedAt: Date.now(),
    }
    await pageMarksRepo.put(next)
    return next
  },

  async remove(id: string): Promise<PageMark | undefined> {
    const current = await pageMarksRepo.get(id)
    if (current) await pageMarksRepo.remove(id)
    return current
  },

  async restore(mark: PageMark): Promise<void> {
    await pageMarksRepo.put(mark)
  },

  get: (id: string) => pageMarksRepo.get(id),
  forPage: (documentId: string, pageNumber: number) => pageMarksRepo.forPage(documentId, pageNumber),
  forDocument: (documentId: string) => pageMarksRepo.forDocument(documentId),
}
