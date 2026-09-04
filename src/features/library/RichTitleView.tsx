import type { RichInlineDoc, RichMark, RichTextNode } from '@/lib/richTitle'
import { displayDoc } from '@/lib/richTitle'

function markClass(marks: RichMark[] | undefined): { className: string; style: React.CSSProperties } {
  const style: React.CSSProperties = {}
  const classes: string[] = ['rich-title-span']
  for (const mark of marks ?? []) {
    if (mark.type === 'bold') classes.push('is-bold')
    if (mark.type === 'italic') classes.push('is-italic')
    if (mark.type === 'underline') classes.push('is-underline')
    if (mark.type === 'strike') classes.push('is-strike')
    if (mark.type === 'textStyle' && typeof mark.attrs?.color === 'string') style.color = mark.attrs.color
    if (mark.type === 'highlight' && typeof mark.attrs?.color === 'string') style.backgroundColor = mark.attrs.color
  }
  return { className: classes.join(' '), style }
}

function Span({ node }: { node: RichTextNode }) {
  const { className, style } = markClass(node.marks)
  return (
    <span className={className} style={style}>
      {node.text}
    </span>
  )
}

export function RichTitleView({
  plain,
  rich,
  className = '',
  dir = 'auto',
}: {
  plain: string
  rich?: unknown
  className?: string
  dir?: 'auto' | 'ltr' | 'rtl'
}) {
  const doc: RichInlineDoc = displayDoc(plain, rich)
  const nodes = doc.content[0]?.content ?? []
  return (
    <span className={`rich-title ${className}`.trim()} dir={dir} data-plain={plain}>
      {nodes.length === 0
        ? null
        : nodes.map((node, index) => <Span key={`${index}:${node.text}`} node={node} />)}
    </span>
  )
}
