import { Node, mergeAttributes } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { annotationsRepo } from '@/db/repos/annotations'
import { booksRepo } from '@/db/repos/library'
import { newBlockId } from '@/db/repos/notes'
import { TRUSTED_CONFIDENCE } from '@/services/annotations/AnchorResolver'
import { AnnotationEngine } from '@/services/annotations/AnnotationEngine'
import { containsRtl } from '@/lib/dir'
import { displayTitle } from '@/lib/bookTitle'
import { useStudyStore } from '@/state/useStudyStore'
import { Icon } from '@/features/shell/Icon'

/**
 * The linked quotation — the single most important node in the schema.
 *
 * It is an **atom**: ProseMirror will not let the user type inside it, split it
 * or partially delete it. That is a structural guarantee that a quotation from
 * the book can never be silently edited into something the author did not
 * write, which matters more here than in a general note-taking app.
 *
 * It stores *only* an annotation id. The Arabic text, the book title and the
 * page number are all read live from the database at render time, so renaming a
 * book updates every quotation everywhere and the sacred text has exactly one
 * copy — the one the AnnotationEngine wrote.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sourceQuote: {
      /**
       * @param at  Where to put it. Omit to append at the end of the note.
       *            Passing the reader's last cursor position is what makes
       *            "Send to Notes" land inside an open toggle rather than at
       *            the bottom of the document (§D3).
       */
      insertSourceQuote: (options: {
        annotationId: string
        blockKind?: string | null
        /** 'quote' inserts the passage alone and leaves the cursor alone. */
        shape?: 'quote' | 'explain' | 'semantic'
        at?: number
      }) => ReturnType
      insertCapture: (options: {
        assetId: string
        annotationId: string | null
        withExplanation?: boolean
        at?: number
      }) => ReturnType
    }
  }
}

/**
 * Where a new source block should go.
 *
 * `at` is the position the reader's cursor was last in, already translated by
 * the editor into a block boundary. It is validated here rather than trusted:
 * the note may have changed since, and inserting at a stale offset would either
 * throw or land the passage inside a word. Anything invalid falls back to the
 * end of the document, which is always safe (§D3).
 */
function resolveInsertPos(doc: ProseMirrorNode, at?: number): number {
  if (at === undefined || at < 0 || at > doc.content.size) return doc.content.size
  try {
    const $pos = doc.resolve(at)
    // Must be a boundary between blocks, not a position inside text.
    return $pos.parent.isTextblock ? $pos.after($pos.depth) : at
  } catch {
    return doc.content.size
  }
}

export const SourceQuote = Node.create({
  name: 'sourceQuote',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      annotationId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-annotation-id'),
        renderHTML: (attrs) => ({ 'data-annotation-id': attrs.annotationId }),
      },
      blockId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-block-id'),
        renderHTML: (attrs) => ({ 'data-block-id': attrs.blockId }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-source-quote]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-source-quote': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(SourceQuoteView)
  },

  addCommands() {
    return {
      insertSourceQuote:
        ({ annotationId, blockKind, shape = 'explain', at }) =>
        ({ tr, dispatch, editor }) => {
          const { schema } = editor
          const quote = schema.nodes.sourceQuote.create({ annotationId, blockId: newBlockId() })
          const pos = resolveInsertPos(tr.doc, at)

          // Send to Notes: the passage on its own, and the cursor stays where
          // the reader left it (§D3).
          if (shape === 'quote') {
            tr.insert(pos, quote)
            if (dispatch) dispatch(tr.scrollIntoView())
            return true
          }

          const semantic = blockKind ? schema.nodes.semanticBlock : null
          const follow = semantic
            ? semantic.create({ kind: blockKind }, schema.nodes.paragraph.create())
            : schema.nodes.paragraph.create()

          // The passage and the commentary go in together as one group, so the
          // relationship is recorded in the document rather than implied by
          // adjacency.
          const group = schema.nodes.sourceGroup.create(null, [quote, follow])
          tr.insert(pos, group)

          if (dispatch) {
            // `near` finds the first valid text position after the quote, which
            // is inside `follow` whether that is a paragraph or a semantic block.
            const selection = TextSelection.near(tr.doc.resolve(pos + 1 + quote.nodeSize + 1), 1)
            dispatch(tr.setSelection(selection).scrollIntoView())
          }
          return true
        },

      insertCapture:
        ({ assetId, annotationId, withExplanation = false, at }) =>
        ({ tr, dispatch, editor }) => {
          const { schema } = editor
          const image = schema.nodes.image.create({ assetId, annotationId })
          const pos = resolveInsertPos(tr.doc, at)

          if (!withExplanation) {
            tr.insert(pos, image)
            if (dispatch) dispatch(tr.scrollIntoView())
            return true
          }

          const paragraph = schema.nodes.paragraph.create()
          tr.insert(pos, [image, paragraph])
          if (dispatch) {
            const selection = TextSelection.near(tr.doc.resolve(pos + image.nodeSize + 1), 1)
            dispatch(tr.setSelection(selection).scrollIntoView())
          }
          return true
        },
    }
  },
})

// ─────────────────────────────────────────────────────────────────────────────

function SourceQuoteView({ node, selected }: NodeViewProps) {
  const annotationId = node.attrs.annotationId as string | null
  const requestJump = useStudyStore((s) => s.requestJump)
  const activeAnnotationId = useStudyStore((s) => s.activeAnnotationId)

  const data = useLiveQuery(async () => {
    if (!annotationId) return null
    const annotation = await annotationsRepo.get(annotationId)
    if (!annotation) return { missing: true as const }
    const book = await booksRepo.get(annotation.bookId)
    const resolved = await AnnotationEngine.resolve(annotationId)
    return {
      missing: false as const,
      annotation,
      book,
      confidence: resolved?.resolution.confidence ?? 0,
      pageNumber: resolved?.resolution.pageNumber ?? annotation.pageNumber,
    }
  }, [annotationId])

  const highlighted = activeAnnotationId === annotationId

  if (!data) {
    return (
      <NodeViewWrapper className="my-2">
        <div className="border-line bg-panel h-16 animate-pulse rounded border" />
      </NodeViewWrapper>
    )
  }

  if (data.missing) {
    return (
      <NodeViewWrapper className="my-2">
        <div className="border-line text-ink-faint rounded border border-dashed px-3 py-2 text-xs">
          The passage this quotation pointed to has been deleted. The note is unaffected.
        </div>
      </NodeViewWrapper>
    )
  }

  const { annotation, book, confidence, pageNumber } = data
  const isEmpty = annotation.selectedText.trim().length === 0
  const rtl = containsRtl(annotation.selectedText)
  const title = displayTitle(book)

  return (
    <NodeViewWrapper className="source-quote" data-drag-handle>
      <div
        className={`source-quote-body ${selected || highlighted ? 'is-active' : ''}`}
        style={{ ['--quote-accent' as string]: `var(--color-hl-${annotation.color})` }}
      >
        <div className="source-quote-label" contentEditable={false}>
          <Icon name="quote" className="h-3 w-3" />
          <span>Source</span>
        </div>

        {isEmpty ? (
          <p className="text-ink-faint text-xs italic">Reading position on page {pageNumber}</p>
        ) : (
          <p dir={rtl ? 'rtl' : 'ltr'} className={rtl ? 'source-quote-text font-arabic' : 'source-quote-text'}>
            {annotation.selectedText}
          </p>
        )}

        <button
          type="button"
          contentEditable={false}
          onClick={() => annotationId && requestJump(annotationId)}
          className="source-quote-link"
          title="Go to this passage in the book"
        >
          <span className="truncate">{title}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">p. {pageNumber}</span>
          <Icon name="arrow-up-right" className="h-3 w-3" />
        </button>

        {confidence > 0 && confidence < TRUSTED_CONFIDENCE && (
          <p className="text-hl-rose mt-1 text-[10.5px]">
            The source text has moved since this was written — check the passage.
          </p>
        )}
        {confidence === 0 && (
          <p className="text-hl-rose mt-1 text-[10.5px]">
            This passage could not be located in the book. Your note is intact.
          </p>
        )}
      </div>
    </NodeViewWrapper>
  )
}
