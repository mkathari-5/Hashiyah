import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Editor } from '@tiptap/core'
import {
  formatReference,
  getRange,
  parseReference,
  searchQuran,
  QURAN_TRANSLATION_ID,
  QURAN_TRANSLATION_LABEL,
  type QuranHit,
  type QuranVerse,
} from '@/services/quran/QuranIndex'

/**
 * Compact Qurʾān picker — search by reference or Arabic/English text, then
 * insert exact corpus āyāt (never LLM-generated).
 */
export function openQuranPicker(editor: Editor): void {
  const host = document.createElement('div')
  document.body.appendChild(host)

  let root: Root | null = null
  const close = () => {
    root?.unmount()
    host.remove()
    editor.commands.focus()
  }

  root = createRoot(host)
  root.render(
    <QuranPickerModal
      onClose={close}
      onInsert={(verses) => {
        insertVerses(editor, verses)
        close()
      }}
    />,
  )
}

function insertVerses(editor: Editor, verses: QuranVerse[]): void {
  if (!verses.length) return
  const first = verses[0]
  const last = verses[verses.length - 1]
  const arabic = verses.map((v) => v.arabic).join(' ')
  const translation = verses.map((v) => v.translation).join(' ')
  const reference = formatReference(verses)

  editor
    .chain()
    .focus()
    .insertContent({
      type: 'quranBlock',
      attrs: {
        reference,
        translation,
        surah: first.surah,
        ayahStart: first.ayah,
        ayahEnd: last.ayah,
        displayMode: 'compact',
        translationId: QURAN_TRANSLATION_ID,
      },
      content: [{ type: 'text', text: arabic }],
    })
    .run()
}

function QuranPickerModal({
  onClose,
  onInsert,
}: {
  onClose: () => void
  onInsert: (verses: QuranVerse[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<QuranHit[]>([])
  const [rangeEnd, setRangeEnd] = useState('')
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    let cancelled = false
    const q = query.trim()
    if (q.length < 1) {
      setHits([])
      return
    }
    const timer = window.setTimeout(() => {
      void searchQuran(q).then((results) => {
        if (!cancelled) {
          setHits(results)
          setActive(0)
        }
      })
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const insertHit = async (hit: QuranHit) => {
    setBusy(true)
    try {
      const ref = parseReference(query.trim())
      if (ref && ref.end > ref.start) {
        const verses = await getRange(ref.surah, ref.start, ref.end)
        if (verses.length) {
          onInsert(verses)
          return
        }
      }
      const end = Number(rangeEnd)
      if (Number.isFinite(end) && end > hit.verse.ayah) {
        const verses = await getRange(hit.verse.surah, hit.verse.ayah, end)
        if (verses.length) {
          onInsert(verses)
          return
        }
      }
      onInsert([hit.verse])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="quran-picker-scrim" onPointerDown={onClose}>
      <div
        className="quran-picker"
        role="dialog"
        aria-label="Insert Qurʾān"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="quran-picker-field">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => Math.min(hits.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter' && hits[active]) {
                e.preventDefault()
                void insertHit(hits[active])
              }
            }}
            placeholder="2:255 · Al-Baqarah 255 · آية الكرسي · Arabic words…"
            className="quran-picker-input"
          />
          <label className="quran-picker-range">
            to āyah
            <input
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="257"
              className="quran-picker-range-input"
              inputMode="numeric"
            />
          </label>
        </div>
        <p className="quran-picker-meta">
          Translation: {QURAN_TRANSLATION_LABEL} · local corpus
        </p>
        <div className="quran-picker-results">
          {query.trim().length === 0 && (
            <p className="quran-picker-note">Search by reference or Arabic. Diacritics are ignored.</p>
          )}
          {hits.map((hit, i) => (
            <button
              key={`${hit.verse.surah}:${hit.verse.ayah}`}
              type="button"
              className={`quran-picker-hit ${i === active ? 'is-active' : ''}`}
              disabled={busy}
              onClick={() => void insertHit(hit)}
            >
              <p className="quran-picker-ar font-arabic" dir="rtl">
                {hit.verse.arabic}
              </p>
              <p className="quran-picker-en">{hit.verse.translation}</p>
              <p className="quran-picker-ref">
                {hit.verse.surahTransliteration} · {hit.verse.surah}:{hit.verse.ayah}
              </p>
            </button>
          ))}
          {query.trim().length > 0 && hits.length === 0 && (
            <p className="quran-picker-note">No matching āyah.</p>
          )}
        </div>
      </div>
    </div>
  )
}
