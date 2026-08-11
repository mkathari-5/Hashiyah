import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useState } from 'react'

/**
 * Qur'ān and Ḥadīth blocks (§14, §15).
 *
 * Both follow the same shape: an editable Arabic body (the ProseMirror content)
 * plus a small strip of *metadata* held as node attributes — sūrah and āyah, or
 * narrator, collection and grading.
 *
 * Two deliberate constraints:
 *
 *  - The Arabic body is ordinary editable content, never a value the app
 *    reformats. Nothing here normalises, re-spaces or "corrects" what is typed.
 *    §57: source text is not ours to rewrite.
 *
 *  - Every metadata field is free text entered by the user and is left empty by
 *    default. The app does not look up sūrah names, infer āyah numbers or
 *    supply gradings, because inventing a reference is far worse than having
 *    none (§24).
 */

interface ScriptureAttrs {
  reference: string
  translation: string
  narrator: string
  collection: string
  grading: string
}

const attrDef = (name: keyof ScriptureAttrs) => ({
  default: '',
  parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`) ?? '',
  renderHTML: (attrs: Record<string, unknown>) =>
    attrs[name] ? { [`data-${name}`]: attrs[name] as string } : {},
})

// ─────────────────────────────────────────────────────────────────────────────

function MetaField({
  value,
  placeholder,
  onChange,
  width = '9rem',
  rtl,
}: {
  value: string
  placeholder: string
  onChange: (value: string) => void
  width?: string
  rtl?: boolean
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      dir={rtl ? 'rtl' : undefined}
      onChange={(e) => onChange(e.target.value)}
      // Keeps ProseMirror from treating typing here as document editing.
      onKeyDown={(e) => e.stopPropagation()}
      className="scripture-meta-input"
      style={{ width }}
    />
  )
}

function ScriptureView({ node, updateAttributes, extension }: NodeViewProps) {
  const attrs = node.attrs as unknown as ScriptureAttrs
  const isQuran = extension.name === 'quranBlock'
  const [showTranslation, setShowTranslation] = useState(
    () => attrs.translation.trim().length > 0,
  )

  return (
    <NodeViewWrapper className={`scripture ${isQuran ? 'scripture-quran' : 'scripture-hadith'}`}>
      <div className="scripture-rule" contentEditable={false} aria-hidden />

      <div className="scripture-head" contentEditable={false}>
        <span className="scripture-kind">{isQuran ? "Qur'ān" : 'Ḥadīth'}</span>
        {isQuran && <span className="scripture-intro font-arabic">قال الله تعالى</span>}
      </div>

      {/* The Arabic body: real editable content, untouched by the app. */}
      <NodeViewContent className="scripture-body font-arabic" dir="rtl" />

      <div className="scripture-meta" contentEditable={false}>
        {isQuran ? (
          <MetaField
            value={attrs.reference}
            placeholder="Sūrah : āyah"
            onChange={(reference) => updateAttributes({ reference })}
            width="11rem"
          />
        ) : (
          <>
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
          </>
        )}

        <button
          type="button"
          onClick={() => setShowTranslation((v) => !v)}
          className="scripture-toggle"
        >
          {showTranslation ? 'Hide translation' : 'Add translation'}
        </button>
      </div>

      {showTranslation && (
        <textarea
          contentEditable={false}
          value={attrs.translation}
          placeholder="Translation — your own wording"
          onChange={(e) => updateAttributes({ translation: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
          rows={2}
          className="scripture-translation"
        />
      )}
    </NodeViewWrapper>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

const base = {
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      reference: attrDef('reference'),
      translation: attrDef('translation'),
      narrator: attrDef('narrator'),
      collection: attrDef('collection'),
      grading: attrDef('grading'),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ScriptureView)
  },
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
  ...base,
  name: 'quranBlock',
  parseHTML() {
    return [{ tag: 'div[data-quran-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-quran-block': '' }), 0]
  },
  addCommands() {
    return {
      insertQuranBlock:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: 'quranBlock' }),
    }
  },
})

export const HadithBlock = Node.create({
  ...base,
  name: 'hadithBlock',
  parseHTML() {
    return [{ tag: 'div[data-hadith-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-hadith-block': '' }), 0]
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
