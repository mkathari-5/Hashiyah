import { annotationsRepo } from '@/db/repos/annotations'
import { booksRepo } from '@/db/repos/library'
import { noteDocsRepo, notesRepo } from '@/db/repos/notes'
import { displayTitle } from '@/lib/bookTitle'
import { SEMANTIC_BY_KIND } from '@/features/notes/extensions/SemanticBlock'

/**
 * Markdown export (§38 of the original brief, §52 here).
 *
 * The rule that shapes this: an exported note must still say where everything
 * came from. A source quotation exports as a blockquote *plus* its book and
 * page, so the file remains useful after it leaves the application. Notes are
 * the user's own data and must never be trapped in here.
 */

interface RawNode {
  type: string
  attrs?: Record<string, unknown>
  content?: RawNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

function inlineToMarkdown(nodes: RawNode[] | undefined): string {
  if (!nodes) return ''
  return nodes
    .map((node) => {
      if (node.type === 'wikiLink') return `[[${String(node.attrs?.label ?? '')}]]`
      if (node.type === 'hardBreak') return '  \n'
      let text = node.text ?? ''
      if (!text) return ''
      for (const mark of node.marks ?? []) {
        if (mark.type === 'bold') text = `**${text}**`
        else if (mark.type === 'italic') text = `*${text}*`
        else if (mark.type === 'strike') text = `~~${text}~~`
        else if (mark.type === 'code') text = `\`${text}\``
        else if (mark.type === 'link') text = `[${text}](${String(mark.attrs?.href ?? '')})`
      }
      return text
    })
    .join('')
}

async function sourceQuoteToMarkdown(annotationId: string): Promise<string> {
  const annotation = await annotationsRepo.get(annotationId)
  if (!annotation) return '> _(source removed)_\n'
  const book = await booksRepo.get(annotation.bookId)
  const quoted = annotation.selectedText
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  const citation = `> \n> — ${displayTitle(book)}, p. ${annotation.pageNumber}`
  return `${quoted}\n${citation}\n`
}

async function blockToMarkdown(node: RawNode, depth: number): Promise<string> {
  const indent = '  '.repeat(depth)

  switch (node.type) {
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      return `${'#'.repeat(level)} ${inlineToMarkdown(node.content)}\n`
    }
    case 'paragraph':
      return `${indent}${inlineToMarkdown(node.content)}\n`
    case 'blockquote':
      return `${indent}> ${inlineToMarkdown(node.content?.[0]?.content)}\n`
    case 'codeBlock':
      return `\`\`\`\n${inlineToMarkdown(node.content)}\n\`\`\`\n`
    case 'horizontalRule':
      return `---\n`
    case 'sourceQuote':
      return sourceQuoteToMarkdown(String(node.attrs?.annotationId ?? ''))
    case 'sourceGroup':
      return childrenToMarkdown(node.content, depth)
    case 'semanticBlock': {
      const meta = SEMANTIC_BY_KIND.get(String(node.attrs?.kind ?? ''))
      const body = await childrenToMarkdown(node.content, depth)
      return `**${meta?.label ?? node.attrs?.kind}**\n\n${body}`
    }
    case 'quranBlock': {
      const ref = node.attrs?.reference ? ` — ${String(node.attrs.reference)}` : ''
      const translation = node.attrs?.translation ? `\n\n_${String(node.attrs.translation)}_` : ''
      return `> ${inlineToMarkdown(node.content)}${ref}${translation}\n`
    }
    case 'hadithBlock': {
      const bits = [node.attrs?.narrator, node.attrs?.collection, node.attrs?.grading]
        .filter(Boolean)
        .map(String)
      const meta = bits.length ? `\n> \n> — ${bits.join(' · ')}` : ''
      const translation = node.attrs?.translation ? `\n\n_${String(node.attrs.translation)}_` : ''
      return `> ${inlineToMarkdown(node.content)}${meta}${translation}\n`
    }
    case 'bulletList':
    case 'orderedList': {
      const ordered = node.type === 'orderedList'
      const items = await Promise.all(
        (node.content ?? []).map(async (item, i) => {
          const marker = ordered ? `${i + 1}.` : '-'
          const body = (await childrenToMarkdown(item.content, depth + 1)).trimStart()
          return `${indent}${marker} ${body}`
        }),
      )
      return items.join('')
    }
    case 'taskList': {
      const items = await Promise.all(
        (node.content ?? []).map(async (item) => {
          const box = item.attrs?.checked ? '[x]' : '[ ]'
          const body = (await childrenToMarkdown(item.content, depth + 1)).trimStart()
          return `${indent}- ${box} ${body}`
        }),
      )
      return items.join('')
    }
    case 'toggleBlock': {
      const summary = inlineToMarkdown(node.content?.[0]?.content)
      const body = await childrenToMarkdown(node.content?.[1]?.content, depth)
      return `<details>\n<summary>${summary}</summary>\n\n${body}\n</details>\n`
    }
    case 'image':
      return `![${String(node.attrs?.alt ?? '')}](asset:${String(node.attrs?.assetId ?? '')})\n`
    case 'table': {
      const rows = node.content ?? []
      const lines = rows.map(
        (row) => `| ${(row.content ?? []).map((cell) => inlineToMarkdown(cell.content?.[0]?.content)).join(' | ')} |`,
      )
      if (lines.length > 0) {
        const columns = (rows[0].content ?? []).length
        lines.splice(1, 0, `|${' --- |'.repeat(columns)}`)
      }
      return `${lines.join('\n')}\n`
    }
    default:
      return childrenToMarkdown(node.content, depth)
  }
}

async function childrenToMarkdown(nodes: RawNode[] | undefined, depth: number): Promise<string> {
  if (!nodes) return ''
  const parts = await Promise.all(nodes.map((child) => blockToMarkdown(child, depth)))
  return parts.join('\n')
}

export async function noteToMarkdown(noteId: string): Promise<string> {
  const note = await notesRepo.get(noteId)
  const row = await noteDocsRepo.get(noteId)
  if (!note || !row) return ''

  const book = note.bookId ? await booksRepo.get(note.bookId) : undefined
  const header = [`# ${note.title}`, book ? `_${displayTitle(book)}_` : null, '']
    .filter((line) => line !== null)
    .join('\n\n')

  const body = await childrenToMarkdown((row.doc as RawNode)?.content, 0)
  return `${header}\n${body}`.replace(/\n{3,}/g, '\n\n')
}

/** Triggers a download without leaving the app or touching the network. */
export function downloadText(filename: string, contents: string, mime = 'text/markdown') {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function exportNote(noteId: string) {
  const note = await notesRepo.get(noteId)
  const markdown = await noteToMarkdown(noteId)
  const safe = (note?.title ?? 'note').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)
  downloadText(`${safe}.md`, markdown)
}
