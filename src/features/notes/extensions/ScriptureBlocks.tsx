import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useState } from 'react'
import { QURAN_TRANSLATION_ID, QURAN_TRANSLATION_LABEL } from '@/services/quran/QuranIndex'

/**
 * Qur'ān and Ḥadīth blocks.
 *
 * Qurʾān insertions from the picker carry corpus metadata (sūrah / āyah /
 * translation id). Legacy free-text blocks remain readable. Default appearance
 * is compact — an āyah is usually supporting evidence, not a poster.
 */

interface ScriptureAttrs {
  reference: string
  translation: string
  narrator: string
  collection: string
  grading: string
  surah: number | null
  ayahStart: number | null
  ayahEnd: number | null
  displayMode: 'compact' | 'display'
  translationId: string
}

const attrDef = (name: keyof ScriptureAttrs, fallback: string | number | null = '') => ({
  default: fallback,
  parseHTML: (el: HTMLElement) => {
    const raw = el.getAttribute(`data-${String(name).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`)
    if (raw == null) return fallback
    if (typeof fallback === 'number' || fallback === null) {
      if (raw === '') return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : fallback
    }
    return raw
  },
  renderHTML: (attrs: Record<string, unknown>) => {
    const value = attrs[name]
    if (value == null || value === '') return {}
    const key = `data-${String(name).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`
    return { [key]: String(value) }
  },
})

function MetaField({
  value,
  placeholder,
  onChange,
  width = '9rem',
}: {
  value: string
  placeholder: string
  onChange: (value: string) => void
  width?: string
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
      className="scripture-meta-input"
      style={{ width }}
    />
  )
}

function QuranView({ node, updateAttributes }: NodeViewProps) {
  const attrs = node.attrs as unknown as ScriptureAttrs
  const mode = attrs.displayMode === 'display' ? 'display' : 'compact'
  const hasCorpus = attrs.surah != null && attrs.ayahStart != null
  const [editing, setEditing] = useState(!hasCorpus && !attrs.reference && !attrs.translation)

  const refLabel =
    attrs.reference ||
    (hasCorpus
      ? `${attrs.surah}:${attrs.ayahStart}${
          attrs.ayahEnd && attrs.ayahEnd !== attrs.ayahStart ? `–${attrs.ayahEnd}` : ''
        }`
      : '')

  return (
    <NodeViewWrapper
      className={`scripture scripture-quran is-${mode}`}
      data-display-mode={mode}
    >
      <div className="scripture-rule" contentEditable={false} aria-hidden />

      <NodeViewContent className="scripture-body font-arabic" dir="rtl" />

      {attrs.translation.trim().length > 0 && (
        <p className="scripture-translation-line" contentEditable={false}>
          {attrs.translation}
        </p>
      )}

      <div className="scripture-foot" contentEditable={false}>
        <span className="scripture-ref">{refLabel}</span>
        {attrs.translationId && (
          <span className="scripture-tr-id" title={QURAN_TRANSLATION_LABEL}>
            {attrs.translationId === QURAN_TRANSLATION_ID ? 'Saheeh Int.' : attrs.translationId}
          </span>
        )}
        <button
          type="button"
          className="scripture-mode"
          title={mode === 'compact' ? 'Emphasise this āyah' : 'Use compact quotation'}
          onClick={() =>
            updateAttributes({ displayMode: mode === 'compact' ? 'display' : 'compact' })
          }
        >
          {mode === 'compact' ? 'Display' : 'Compact'}
        </button>
        {!hasCorpus && (
          <button type="button" className="scripture-mode" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>

      {editing && (
        <div className="scripture-meta" contentEditable={false}>
          <MetaField
            value={attrs.reference}
            placeholder="Sūrah · reference"
            onChange={(reference) => updateAttributes({ reference })}
            width="12rem"
          />
          <textarea
            value={attrs.translation}
            placeholder="Translation"
            onChange={(e) => updateAttributes({ translation: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            rows={2}
            className="scripture-translation"
          />
        </div>
      )}
    </NodeViewWrapper>
  )
}

function HadithView({ node, updateAttributes }: NodeViewProps) {
  const attrs = node.attrs as unknown as ScriptureAttrs
  const [showMeta, setShowMeta] = useState(
    () => !attrs.narrator && !attrs.collection && !attrs.grading && !attrs.translation,
  )

  return (
    <NodeViewWrapper className="scripture scripture-hadith is-compact">
      <div className="scripture-rule" contentEditable={false} aria-hidden />

      <NodeViewContent className="scripture-body font-arabic" dir="rtl" />

      {attrs.translation.trim().length > 0 && (
        <p className="scripture-translation-line" contentEditable={false}>
          {attrs.translation}
        </p>
      )}

      <div className="scripture-foot" contentEditable={false}>
        <span className="scripture-ref">
          {[attrs.narrator, attrs.collection, attrs.grading].filter(Boolean).join(' · ') || 'Ḥadīth'}
        </span>
        <button type="button" className="scripture-mode" onClick={() => setShowMeta((v) => !v)}>
          {showMeta ? 'Done' : 'Edit'}
        </button>
      </div>

      {showMeta && (
        <div className="scripture-meta" contentEditable={false}>
          <MetaField
            value={attrs.narrator}
            placeholder="Narrator"
            onChange={(narrator) => updateAttributes({ narrator })}
          />
          <MetaField
            value={attrs.collection}
            placeholder="Collection & number"
            onChange={(collection) => updateAttributes({ collection })}
            width="12rem"
          />
          <MetaField
            value={attrs.grading}
            placeholder="Grading"
            onChange={(grading) => updateAttributes({ grading })}
            width="7rem"
          />
          <textarea
            value={attrs.translation}
            placeholder="Translation / notes"
            onChange={(e) => updateAttributes({ translation: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            rows={2}
            className="scripture-translation"
          />
        </div>
      )}
    </NodeViewWrapper>
  )
}

const quranAttrs = {
  reference: attrDef('reference', ''),
  translation: attrDef('translation', ''),
  narrator: attrDef('narrator', ''),
  collection: attrDef('collection', ''),
  grading: attrDef('grading', ''),
  surah: attrDef('surah', null),
  ayahStart: attrDef('ayahStart', null),
  ayahEnd: attrDef('ayahEnd', null),
  displayMode: attrDef('displayMode', 'compact'),
  translationId: attrDef('translationId', ''),
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    scripture: {
      insertQuranBlock: () => ReturnType
      insertHadithBlock: () => ReturnType
    }
  }
}

export const QuranBlock = Node.create({
  name: 'quranBlock',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return quranAttrs
  },

  parseHTML() {
    return [{ tag: 'div[data-quran-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-quran-block': '' }), 0]
  },
  addNodeView() {
    return ReactNodeViewRenderer(QuranView)
  },
  addCommands() {
    return {
      insertQuranBlock:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: 'quranBlock', attrs: { displayMode: 'compact' } }),
    }
  },
})

export const HadithBlock = Node.create({
  name: 'hadithBlock',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      reference: attrDef('reference', ''),
      translation: attrDef('translation', ''),
      narrator: attrDef('narrator', ''),
      collection: attrDef('collection', ''),
      grading: attrDef('grading', ''),
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-hadith-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-hadith-block': '' }), 0]
  },
  addNodeView() {
    return ReactNodeViewRenderer(HadithView)
  },
  addCommands() {
    return {
      insertHadithBlock:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: 'hadithBlock' }),
    }
  },
})
