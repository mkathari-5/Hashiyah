# Ḥāshiyah

**ḥāshiyah** (حاشية) — the marginal gloss written around the text of a book.

A book-centred study environment for Islamic texts. The book is the primary
object; notes, explanations, benefits and questions stay permanently attached to
the exact passage in the book where they were learned.

This is not a note-taking app with a PDF viewer in it.

---

## Running it

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:5174>. Everything is local — there is no server, no
account, and no network request in the reading path. Your books and notes live
in IndexedDB in that browser profile.

Other scripts:

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build
```

To generate the synthetic Arabic PDF used for manual testing:

```bash
node scripts/make-test-pdf.mjs
```

---

## The workflow it exists for

1. Open a book.
2. Select a passage — Arabic or English.
3. Press **Ctrl+E**.
4. The exact quotation appears in your notes, with the book and page recorded,
   and the cursor is already blinking underneath it.
5. Type. Keep reading.

Later, clicking the quotation returns to the exact sentence in the book and
pulses it. Clicking a highlight in the book reveals what you wrote about it.

## Keyboard

| | |
|---|---|
| `Ctrl+E` | Extract the selection and explain it |
| `Ctrl+H` | Highlight |
| `Ctrl+Shift+B / D / T / Q / R` | Extract as Fāʾidah / Definition / Teacher / Question / Reference |
| `Ctrl+Shift+N` | Note at my current position |
| `Ctrl+K` or `Ctrl+P` | Command palette |
| `Ctrl+Shift+F` | Search the library |
| `Ctrl+F` | Find in the current note |
| `Ctrl+Shift+L` | Lesson Mode |
| `Ctrl+1 / 2 / 3 / 4` | Library+book+notes / study / book only / notes only |
| `Ctrl+Shift+E` | Toggle notes full screen |
| `Ctrl+Shift+M` | Dark ⇄ light |
| `Ctrl+/` | All shortcuts |

In the editor: `/` opens the block menu, `[[` links to another note or book,
and the usual markdown prefixes work — `#`, `##`, `###`, `-`, `1.`, `>`, `[]`.

---

## What is built

**Reading.** Library hierarchy with Recent and Favourites · PDF import with
background text indexing · virtualised continuous reader · Arabic and English
text selection · highlights · reading-position restore.

**The link.** **Extract & Explain** · redundant source anchors with a
six-strategy resolver · bidirectional navigation · a **source group** that binds
a passage to every explanation, benefit and question written about it.

**The editor.** Block editor with drag handles and a block menu (turn into,
duplicate, move, colour, copy link, delete) · headings, lists, checklists,
nested toggles, tables, images · 15 Islamic semantic block types · dedicated
Qur'ān and Ḥadīth blocks · grouped slash menu with ranked search · floating
format bar · markdown input rules · per-block automatic RTL with manual
override · `[[ ]]` internal links · outline navigator · find-in-note ·
word count · Markdown export.

**The shell.** Four layout modes (library+book+notes, study, book only, notes
only) · lesson mode · resizable panels with double-click restore · command
palette · dark, light and system themes.

## What is *not* built

OCR · handwriting and Apple Pencil · margin mode · workspace canvas ·
commentary layers · knowledge base · cloud sync · version history · AI.

None of these appear as working controls. Where they are referenced at all they
are visibly disabled or absent. No enabled button in this app is a placeholder.

---

## Reading the code

Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — it covers the module
boundaries, the schema and, most importantly, the anchoring strategy, which is
the idea the whole product rests on.

The three files worth reading first:

- `src/lib/arabic.ts` — normalisation that always returns an index map back to
  the original text. Everything Arabic depends on this.
- `src/services/annotations/AnchorResolver.ts` — how a note finds its passage
  again, with six independent fallbacks.
- `src/services/pdf/pageText.ts` — the canonical page text shared by the
  importer and the live text layer. Small, and load-bearing.

## Known limitations

- **Scanned books.** Pages with no embedded text layer cannot be selected. They
  are detected at import and flagged honestly in the status bar rather than
  offering a selection that would not work. The `OCRProvider` seam exists.
- **Variable page sizes.** Page slots are laid out from page 1's aspect ratio.
  Books that mix page sizes will have slightly imprecise scrollbar geometry.
- **Search** is a scan over indexed pages, not an inverted index. Fast well into
  the tens of thousands of pages; the interface is designed so the internals can
  be replaced without touching callers.
- Tiptap logs a development-only `flushSync` warning on first mount from its own
  `ReactRenderer`. Upstream; the production console is clean.
