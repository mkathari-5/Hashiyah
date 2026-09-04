import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import {
  FORMAT_HIGHLIGHT_COLORS,
  FORMAT_TEXT_COLORS,
  NOTE_FONTS,
  NOTE_FONT_SIZES,
  NOTE_LINE_SPACING,
} from '@/features/editor/formatColors'
import type { BlockAlign } from '@/features/notes/extensions/BlockDirection'
import { Icon } from '@/features/shell/Icon'
import { insertTableSafely } from '@/features/notes/insertHelpers'

type Menu = null | 'style' | 'font' | 'size' | 'color' | 'highlight' | 'line' | 'insert' | 'dir' | 'more' | 'link'

export function NotesToolbar({
  editor,
  onFind,
  onReplace,
}: {
  editor: Editor
  onFind: () => void
  onReplace: () => void
}) {
  const [menu, setMenu] = useState<Menu>(null)
  const [linkValue, setLinkValue] = useState('')
  const [, force] = useState(0)
  const barRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const update = () => force((n) => n + 1)
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
    }
  }, [editor])

  useEffect(() => {
    if (!menu) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenu(null)
        editor.view.focus()
      }
    }
    const onDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setMenu(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [menu, editor])

  const run = useCallback(
    (fn: () => void) => {
      fn()
      editor.view.focus()
    },
    [editor],
  )

  const attrs = editor.getAttributes('paragraph')
  const heading = editor.getAttributes('heading')
  const dirLock = !!(attrs.dirLock ?? heading.dirLock)
  const currentDir = dirLock ? ((attrs.dir as string | null) ?? (heading.dir as string | null) ?? null) : null
  const currentAlign = (attrs.textAlign as BlockAlign | null) ?? (heading.textAlign as BlockAlign | null) ?? null
  const currentSize = (editor.getAttributes('textStyle').fontSize as string | null) ?? ''
  const currentFont = (editor.getAttributes('textStyle').fontFamily as string | null) ?? ''
  const currentLine = (attrs.lineHeight as string | null) ?? (heading.lineHeight as string | null) ?? '1.5'
  const currentColor = (editor.getAttributes('textStyle').color as string | undefined) || ''
  const currentHighlight = (editor.getAttributes('highlight').color as string | undefined) || ''
  const currentHref = (editor.getAttributes('link').href as string | undefined) || ''

  const Btn = ({
    active,
    disabled,
    onClick,
    title,
    children,
  }: {
    active?: boolean
    disabled?: boolean
    onClick: () => void
    title: string
    children: React.ReactNode
  }) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={!!active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`notes-tb-btn${active ? ' is-active' : ''}`}
    >
      {children}
    </button>
  )

  const applyLink = () => {
    const href = linkValue.trim()
    if (!href) run(() => editor.chain().unsetLink().run())
    else run(() => editor.chain().extendMarkRange('link').setLink({ href }).run())
    setMenu(null)
  }

  return (
    <div ref={barRef} className="notes-toolbar" role="toolbar" aria-label="Document formatting">
      <div className="notes-tb-group" aria-label="History">
        <Btn title="Undo  Ctrl+Z" disabled={!editor.can().undo()} onClick={() => run(() => editor.chain().undo().run())}>
          <Icon name="undo" className="h-3.5 w-3.5" />
        </Btn>
        <Btn title="Redo  Ctrl+Shift+Z" disabled={!editor.can().redo()} onClick={() => run(() => editor.chain().redo().run())}>
          <Icon name="redo" className="h-3.5 w-3.5" />
        </Btn>
      </div>

      <div className="notes-tb-group" aria-label="Text style">
        <Btn title="Text style" active={menu === 'style'} onClick={() => setMenu((m) => (m === 'style' ? null : 'style'))}>
          {editor.isActive('heading', { level: 1 })
            ? 'H1'
            : editor.isActive('heading', { level: 2 })
              ? 'H2'
              : editor.isActive('heading', { level: 3 })
                ? 'H3'
                : 'Aa'}
        </Btn>
        {menu === 'style' && (
          <div className="notes-tb-menu" role="menu">
            {[
              { label: 'Normal', run: () => editor.chain().setParagraph().run() },
              { label: 'Heading 1', run: () => editor.chain().setHeading({ level: 1 }).run() },
              { label: 'Heading 2', run: () => editor.chain().setHeading({ level: 2 }).run() },
              { label: 'Heading 3', run: () => editor.chain().setHeading({ level: 3 }).run() },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="block-menu-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  run(item.run)
                  setMenu(null)
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="notes-tb-group notes-tb-font" aria-label="Font">
        <Btn title="Font" active={menu === 'font'} onClick={() => setMenu((m) => (m === 'font' ? null : 'font'))}>
          {NOTE_FONTS.find((font) => font.value === currentFont)?.label ?? 'Font'}
        </Btn>
        {menu === 'font' && (
          <div className="notes-tb-menu" role="menu">
            <button type="button" className="block-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => run(() => editor.chain().setFontFamily(null).run())}>
              Default
            </button>
            {NOTE_FONTS.map((font) => (
              <button
                key={font.label}
                type="button"
                className="block-menu-item"
                style={{ fontFamily: font.value }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  run(() => editor.chain().setFontFamily(font.value).run())
                  setMenu(null)
                }}
              >
                {font.label}
              </button>
            ))}
          </div>
        )}
        <Btn title="Font size" active={menu === 'size'} onClick={() => setMenu((m) => (m === 'size' ? null : 'size'))}>
          {currentSize ? currentSize.replace('px', '') : '16'}
        </Btn>
        {menu === 'size' && (
          <div className="notes-tb-menu" role="menu">
            {NOTE_FONT_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                className="block-menu-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  run(() => editor.chain().setFontSize(size).run())
                  setMenu(null)
                }}
              >
                {size.replace('px', '')}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="notes-tb-group" aria-label="Character formatting">
        <Btn title="Bold  Ctrl+B" active={editor.isActive('bold')} onClick={() => run(() => editor.chain().toggleBold().run())}>
          <b>B</b>
        </Btn>
        <Btn title="Italic  Ctrl+I" active={editor.isActive('italic')} onClick={() => run(() => editor.chain().toggleItalic().run())}>
          <i>I</i>
        </Btn>
        <Btn title="Underline  Ctrl+U" active={editor.isActive('underline')} onClick={() => run(() => editor.chain().toggleUnderline().run())}>
          <span className="underline">U</span>
        </Btn>
        <Btn title="Strikethrough" active={editor.isActive('strike')} onClick={() => run(() => editor.chain().toggleStrike().run())}>
          <s>S</s>
        </Btn>
        <Btn title="Superscript" active={editor.isActive('superscript')} onClick={() => run(() => editor.chain().toggleSuperscript().run())}>
          x²
        </Btn>
        <Btn title="Subscript" active={editor.isActive('subscript')} onClick={() => run(() => editor.chain().toggleSubscript().run())}>
          x₂
        </Btn>
        <Btn title="Clear formatting" onClick={() => run(() => editor.chain().unsetAllMarks().unsetHighlight().unsetColor().setFontSize(null).setFontFamily(null).run())}>
          ⌧
        </Btn>
      </div>

      <div className="notes-tb-group" aria-label="Colour">
        <Btn title="Text colour" active={menu === 'color' || !!currentColor} onClick={() => setMenu((m) => (m === 'color' ? null : 'color'))}>
          <span className="notes-tb-swatch-letter" style={{ borderBottomColor: currentColor || 'currentColor' }}>
            A
          </span>
        </Btn>
        {menu === 'color' && (
          <div className="notes-tb-menu" role="menu" aria-label="Text colour">
            {FORMAT_TEXT_COLORS.map((color) => (
              <button
                key={color.label}
                type="button"
                className="block-menu-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => run(() => (color.value ? editor.chain().setColor(color.value).run() : editor.chain().unsetColor().run()))}
              >
                <span className="block-menu-swatch" style={{ background: color.value ?? 'var(--color-ink)' }} />
                {color.label}
              </button>
            ))}
          </div>
        )}
        <Btn title="Highlight colour" active={menu === 'highlight' || !!currentHighlight} onClick={() => setMenu((m) => (m === 'highlight' ? null : 'highlight'))}>
          <span className="notes-tb-swatch-letter" style={{ background: currentHighlight || 'transparent' }}>
            ▮
          </span>
        </Btn>
        {menu === 'highlight' && (
          <div className="notes-tb-menu" role="menu" aria-label="Highlight colour">
            {FORMAT_HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.label}
                type="button"
                className="block-menu-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  run(() =>
                    color.value ? editor.chain().setHighlight({ color: color.value }).run() : editor.chain().unsetHighlight().run(),
                  )
                }
              >
                <span className="block-menu-swatch" style={{ background: color.value ?? 'transparent', border: '1px solid var(--color-line-strong)' }} />
                {color.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="notes-tb-group" aria-label="Paragraph">
        <Btn title="Align start" active={currentAlign === 'start'} onClick={() => run(() => editor.chain().setBlockAlign('start').run())}>
          ⇤
        </Btn>
        <Btn title="Centre" active={currentAlign === 'center'} onClick={() => run(() => editor.chain().setBlockAlign('center').run())}>
          ≡
        </Btn>
        <Btn title="Align end" active={currentAlign === 'end'} onClick={() => run(() => editor.chain().setBlockAlign('end').run())}>
          ⇥
        </Btn>
        <Btn title="Justify" active={currentAlign === 'justify'} onClick={() => run(() => editor.chain().setBlockAlign('justify').run())}>
          ☰
        </Btn>
        <Btn title="Line spacing" active={menu === 'line'} onClick={() => setMenu((m) => (m === 'line' ? null : 'line'))}>
          ↕
        </Btn>
        {menu === 'line' && (
          <div className="notes-tb-menu" role="menu">
            {NOTE_LINE_SPACING.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`block-menu-item${currentLine === item.value ? ' text-accent' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  run(() => editor.chain().setLineHeight(item.value).run())
                  setMenu(null)
                }}
              >
                {item.label}
              </button>
            ))}
            <div className="block-menu-sep" />
            <button type="button" className="block-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => run(() => editor.chain().setParagraphSpacing({ after: '0.6em' }).run())}>
              Space after
            </button>
            <button type="button" className="block-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => run(() => editor.chain().setParagraphSpacing({ before: '0.6em' }).run())}>
              Space before
            </button>
          </div>
        )}
        <Btn title="Decrease indent" onClick={() => run(() => editor.chain().adjustBlockIndent(-1).run())}>
          «
        </Btn>
        <Btn title="Increase indent" onClick={() => run(() => editor.chain().adjustBlockIndent(1).run())}>
          »
        </Btn>
      </div>

      <div className="notes-tb-group" aria-label="Lists">
        <Btn title="Bulleted list" active={editor.isActive('bulletList')} onClick={() => run(() => editor.chain().toggleBulletList().run())}>
          •
        </Btn>
        <Btn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => run(() => editor.chain().toggleOrderedList().run())}>
          1.
        </Btn>
        <Btn title="Checklist" active={editor.isActive('taskList')} onClick={() => run(() => editor.chain().toggleTaskList().run())}>
          ☑
        </Btn>
        <Btn title="Blockquote" active={editor.isActive('blockquote')} onClick={() => run(() => editor.chain().toggleBlockquote().run())}>
          ❝
        </Btn>
        <Btn title="Code block" active={editor.isActive('codeBlock')} onClick={() => run(() => editor.chain().toggleCodeBlock().run())}>
          {'</>'}
        </Btn>
      </div>

      <div className="notes-tb-group" aria-label="Insert">
        <Btn title="Insert" active={menu === 'insert'} onClick={() => setMenu((m) => (m === 'insert' ? null : 'insert'))}>
          +
        </Btn>
        {menu === 'insert' && (
          <div className="notes-tb-menu" role="menu">
            <button type="button" className={`block-menu-item${currentHref ? ' text-accent' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => { setLinkValue(currentHref); setMenu('link') }}>
              Link
            </button>
            <button type="button" className="block-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => imageRef.current?.click()}>
              Image
            </button>
            <button type="button" className="block-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { run(() => insertTableSafely(editor)); setMenu(null) }}>
              Table
            </button>
            <button type="button" className="block-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { run(() => editor.chain().setHorizontalRule().run()); setMenu(null) }}>
              Divider
            </button>
            <button type="button" className="block-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { run(() => editor.chain().insertToggle().run()); setMenu(null) }}>
              Toggle
            </button>
            {editor.isActive('table') && (
              <>
                <div className="block-menu-sep" />
                <button type="button" className="block-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => run(() => editor.chain().addRowAfter().run())}>
                  Add row
                </button>
                <button type="button" className="block-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => run(() => editor.chain().deleteRow().run())}>
                  Remove row
                </button>
                <button type="button" className="block-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => run(() => editor.chain().addColumnAfter().run())}>
                  Add column
                </button>
                <button type="button" className="block-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => run(() => editor.chain().deleteColumn().run())}>
                  Remove column
                </button>
                <button type="button" className="block-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => run(() => editor.chain().toggleHeaderRow().run())}>
                  Header row
                </button>
                <button type="button" className="block-menu-item is-danger" onMouseDown={(e) => e.preventDefault()} onClick={() => run(() => editor.chain().deleteTable().run())}>
                  Delete table
                </button>
              </>
            )}
          </div>
        )}
        {menu === 'link' && (
          <div className="notes-tb-menu notes-tb-link" onPointerDown={(event) => event.stopPropagation()}>
            <input
              value={linkValue}
              onChange={(event) => setLinkValue(event.target.value)}
              placeholder="https://"
              aria-label="Link URL"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  applyLink()
                }
              }}
            />
            <button type="button" className="ui-btn" onClick={applyLink}>
              Apply
            </button>
            <button type="button" className="ui-btn" onClick={() => run(() => editor.chain().unsetLink().run())}>
              Remove
            </button>
          </div>
        )}
        <input
          ref={imageRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) run(() => editor.chain().insertImageFile(file).run())
            event.target.value = ''
            setMenu(null)
          }}
        />
      </div>

      <div className="notes-tb-group" aria-label="Direction">
        <Btn title="Automatic direction" active={!dirLock} onClick={() => run(() => editor.chain().setBlockDirection(null).run())}>
          Auto
        </Btn>
        <Btn title="Left to right" active={currentDir === 'ltr'} onClick={() => run(() => editor.chain().setBlockDirection('ltr').run())}>
          A
        </Btn>
        <Btn title="Right to left" active={currentDir === 'rtl'} onClick={() => run(() => editor.chain().setBlockDirection('rtl').run())}>
          ع
        </Btn>
      </div>

      <div className="notes-tb-group notes-tb-doc" aria-label="Document tools">
        <Btn title="Find  Ctrl+F" onClick={onFind}>
          ⌕
        </Btn>
        <Btn title="Find and replace" onClick={onReplace}>
          ⇄
        </Btn>
        <Btn title="Select all  Ctrl+A" onClick={() => run(() => editor.chain().selectAll().run())}>
          All
        </Btn>
        <Btn
          title="Paste as plain text"
          onClick={() => {
            void navigator.clipboard
              .readText()
              .then((text) => {
                if (text) run(() => editor.chain().insertContent(text).run())
              })
              .catch(() => undefined)
          }}
        >
          Plain
        </Btn>
        <Btn title="Print" onClick={() => window.print()}>
          Print
        </Btn>
      </div>
    </div>
  )
}
