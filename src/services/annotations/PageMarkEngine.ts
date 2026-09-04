import { pageMarksRepo } from '@/db/repos/pageMarks'
import { ids } from '@/lib/id'
import { isMarginRect } from '@/services/pdf/pageCoords'
import type { NormalizedRect, PageMark, PageMarkKind, PageMarkStyle } from '@/types'

export const DEFAULT_MARK_STYLE: PageMarkStyle = {
  fontSize: 15,
  color: '#6b5344',
  direction: 'auto',
  align: 'start',
  fillColor: '#d8a13d',
  fillOpacity: 0.28,
  strokeColor: '#6b5344',
  strokeWidth: 1.5,
}

export const MARK_COLORS = ['#6b5344', '#8a6a3b', '#3f5d4a', '#3d5a73', '#7a4a48', '#5c4d73', '#1f1b16'] as const

export const MARK_SIZES = [12, 14, 15, 18, 22, 28, 36]

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
