import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { annotationsRepo } from '@/db/repos/annotations'
import { booksRepo } from '@/db/repos/library'
import { displayTitle } from '@/lib/bookTitle'
import { newId } from '@/lib/id'
import { useStudyStore } from '@/state/useStudyStore'
import { Icon } from '@/features/shell/Icon'

/**
 * Images stored by reference (§D13, §D14).
 *
 * The node holds an asset id and — for PDF captures — the id of the source
 * annotation. It never holds the bytes: a screenshot pasted into a lesson would
 * otherwise be re-serialised into the note document on every autosave.
 *
 * Controls stay hidden until the block is hovered or selected (§D14), so a page
 * of captures still reads as notes rather than as a toolbar catalogue.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imageBlock: {
      insertImagePicker: () => ReturnType
      insertImageFile: (file: File) => ReturnType
    }
  }
}

type Align = 'start' | 'center' | 'end'

async function storeImage(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null
  const url = URL.createObjectURL(file)
  try {
    const size = await new Promise<{ width: number; height: number }>((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => resolve({ width: 0, height: 0 })
      img.src = url
    })
    const id = newId('img')
    await db.assets.add({ id, blob: file, mime: file.type, ...size, createdAt: Date.now() })
    return id
  } finally {
    URL.revokeObjectURL(url)
  }
}

function ImageView({ node, updateAttributes, selected, deleteNode }: NodeViewProps) {
  const assetId = node.attrs.assetId as string | null
  const annotationId = node.attrs.annotationId as string | null
  const caption = (node.attrs.caption as string) ?? ''
  const align = (node.attrs.align as Align) ?? 'start'
  const width = node.attrs.width as number | null

  const requestJump = useStudyStore((s) => s.requestJump)
  const [src, setSrc] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const figureRef = useRef<HTMLElement>(null)
  const dragState = useRef<{ startX: number; startWidth: number; dir: 1 | -1 } | null>(null)

  useEffect(() => {
    if (!assetId) return
    let url: string | null = null
    let cancelled = false
    void db.assets.get(assetId).then((asset) => {
      if (cancelled) return
      if (!asset) {
        setMissing(true)
        return
      }
      url = URL.createObjectURL(asset.blob)
      setSrc(url)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [assetId])

  const source = useLiveQuery(async () => {
    if (!annotationId) return null
    const annotation = await annotationsRepo.get(annotationId)
    if (!annotation) return null
    const book = await booksRepo.get(annotation.bookId)
    return { page: annotation.pageNumber, title: displayTitle(book) }
  }, [annotationId])

  // §D14 — drag either edge to resize; aspect ratio is preserved because only
  // the width is ever set.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const state = dragState.current
      if (!state || !figureRef.current) return
      const delta = (event.clientX - state.startX) * state.dir
      const parent = figureRef.current.parentElement?.getBoundingClientRect().width ?? 640
      const next = Math.max(80, Math.min(parent, state.startWidth + delta * 2))
      figureRef.current.style.width = `${Math.round(next)}px`
    }
    const onUp = () => {
      if (!dragState.current || !figureRef.current) return
      dragState.current = null
      updateAttributes({ width: Math.round(figureRef.current.getBoundingClientRect().width) })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [updateAttributes])

  const startResize = (dir: 1 | -1) => (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    dragState.current = {
      startX: event.clientX,
      startWidth: figureRef.current?.getBoundingClientRect().width ?? 320,
      dir,
    }
  }

  const copyImage = async () => {
    if (!assetId) return
    const asset = await db.assets.get(assetId)
    if (!asset) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ [asset.mime]: asset.blob })])
    } catch {
      /* Clipboard image support varies; failing quietly is better than a dialog. */
    }
  }

  if (missing) {
    return (
      <NodeViewWrapper className="image-block">
        <div className="border-line text-ink-faint rounded border border-dashed px-3 py-6 text-center text-xs">
          This image is no longer in local storage.
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="image-block" data-align={align}>
      <figure
        ref={figureRef}
        className={selected ? 'is-selected' : ''}
        style={width ? { width: `${width}px` } : undefined}
      >
        <div className="image-frame" data-drag-handle>
          {src ? <img src={src} alt={caption || 'Captured from the book'} draggable={false} /> : <div className="image-skeleton" />}

          <span className="image-grip image-grip-start" onPointerDown={startResize(-1)} aria-hidden />
          <span className="image-grip image-grip-end" onPointerDown={startResize(1)} aria-hidden />

          <div className="image-tools" contentEditable={false}>
            {(['start', 'center', 'end'] as Align[]).map((value) => (
              <button
                key={value}
                type="button"
                title={`Align ${value === 'start' ? 'left' : value === 'end' ? 'right' : 'centre'}`}
                aria-pressed={align === value}
                onClick={() => updateAttributes({ align: value })}
                className={align === value ? 'is-active' : ''}
              >
                {value === 'start' ? '⤺' : value === 'center' ? '≡' : '⤻'}
              </button>
            ))}
            <span className="image-tools-sep" />
            <button type="button" title="Copy image" onClick={copyImage}>
              ⧉
            </button>
            <button type="button" title="Reset size" onClick={() => updateAttributes({ width: null })}>
              ↺
            </button>
            <button type="button" title="Delete" onClick={() => deleteNode()}>
              🗑
            </button>
          </div>
        </div>

        <figcaption>
          <input
            value={caption}
            placeholder="Caption"
            onChange={(e) => updateAttributes({ caption: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
          {source && (
            <button
              type="button"
              contentEditable={false}
              className="image-source"
              title="Go back to this region in the book"
              onClick={() => annotationId && requestJump(annotationId)}
            >
              <span className="truncate">{source.title}</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">p. {source.page}</span>
              <Icon name="arrow-up-right" className="h-3 w-3" />
            </button>
          )}
        </figcaption>
      </figure>
    </NodeViewWrapper>
  )
}

export const ImageBlock = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    const attr = (name: string, dataName: string, parse: (v: string | null) => unknown) => ({
      default: null,
      parseHTML: (el: HTMLElement) => parse(el.getAttribute(dataName)),
      renderHTML: (attrs: Record<string, unknown>) =>
        attrs[name] === null || attrs[name] === undefined ? {} : { [dataName]: String(attrs[name]) },
    })

    return {
      assetId: attr('assetId', 'data-asset-id', (v) => v),
      annotationId: attr('annotationId', 'data-annotation-id', (v) => v),
      width: attr('width', 'data-width', (v) => (v ? Number(v) : null)),
      align: {
        default: 'start',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-align') ?? 'start',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-align': String(attrs.align ?? 'start') }),
      },
      caption: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-caption') ?? '',
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.caption ? { 'data-caption': String(attrs.caption) } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-image-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-image-block': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },

  addCommands() {
    return {
      insertImageFile:
        (file) =>
        ({ editor }) => {
          void storeImage(file).then((assetId) => {
            if (assetId) editor.chain().focus().insertContent({ type: 'image', attrs: { assetId } }).run()
          })
          return true
        },

      insertImagePicker:
        () =>
        ({ editor }) => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'image/*'
          input.onchange = () => {
            const file = input.files?.[0]
            if (file) editor.commands.insertImageFile(file)
          }
          input.click()
          return true
        },
    }
  },
})
