# Ḥāshiyah — Architecture

> **ḥāshiyah** (حاشية) — the marginal gloss written around the text of a book.
> The name is the product thesis: the book is the page, your knowledge is the margin.

---

## 0. Product understanding (one paragraph)

This is **not** a note app with a PDF viewer bolted on. The *document* is the primary
object in the data model and in the UI. A note has no independent existence worth
speaking of — it is *a thing said about a passage*. Therefore the schema is built
around one irreducible relationship:

```
Document → Page → Passage(anchor) → Annotation → NoteBlock → Note
```

Everything else (library hierarchy, lessons, layers, concepts, the canvas) is
navigation and grouping placed *on top of* that spine. The single metric the
product optimises is the latency of:

**select → shortcut → type → keep reading.**

---

## A. System architecture

Nine modules, each with an explicit boundary. The rule that produces the
boundaries: *anything that could plausibly be swapped out in 18 months gets an
interface now.*

```
┌────────────────────────────────────────────────────────────────────┐
│ UI LAYER  (React, feature-sliced — knows nothing about pdf.js)     │
│  shell · library · pdf · notes · search · command · shortcuts      │
└───────────────┬────────────────────────────────────────────────────┘
                │ hooks + zustand stores (no domain logic)
┌───────────────▼────────────────────────────────────────────────────┐
│ SERVICE LAYER  (pure TS, no React, unit-testable in node)          │
│                                                                    │
│  PdfProvider ──── loads docs, renders pages, extracts text         │
│  AnnotationEngine ── the ONLY writer of annotations + anchors      │
│  AnchorResolver ─ annotation ⇄ page coordinates (6-signal cascade) │
│  NotesService ─── note docs, quote-ref index maintenance           │
│  SearchEngine ── one query → grouped results across all sources    │
│  LibraryManager ─ hierarchy, ordering, reading state               │
│  ExportEngine ─── note/book/library → md · html · json · txt       │
│  OCRProvider ──── interface only in Phase 1 (NullOcrProvider)      │
│  SyncEngine ───── interface only in Phase 1 (LocalOnlySync)        │
└───────────────┬────────────────────────────────────────────────────┘
                │ repositories (the only code that touches Dexie)
┌───────────────▼────────────────────────────────────────────────────┐
│ PERSISTENCE  Dexie / IndexedDB — blobs, metadata, text, PM docs    │
└────────────────────────────────────────────────────────────────────┘
```

### Why these seams specifically

| Seam | What it buys |
|---|---|
| `AnchorResolver` split from `AnnotationEngine` | Anchoring is the hardest, most-likely-to-be-revised algorithm in the product. It is a pure function `(anchor, pageText, pageGeometry) → resolution`. It can be fuzz-tested with zero DOM. |
| `PdfProvider` interface | pdf.js is the implementation, not the contract. A future native/iPad renderer (PDFKit) implements the same 5 methods. |
| Repositories wrap Dexie | Phase 3 sync needs to intercept every write. One place to add it. |
| `OCRProvider` exists now, returns "unsupported" | Annotations already carry `textSource: 'embedded' | 'ocr'`. Adding OCR later writes new `pages` rows; the annotation system never learns OCR exists. |
| Notes editor has **zero** PDF knowledge | The `sourceQuote` node stores an `annotationId` and nothing else. Resolution is a service call. |

---

## B. Data model

### Design changes from the brief's draft schema (and why)

1. **`documents` split into `documents` (metadata) and `documentBlobs` (bytes).**
   A library listing must never pull 40 MB of PDF into memory. Dexie will
   deserialise the whole row otherwise.

2. **`Book` and `Document` kept separate** — the brief implied this and it's
   right. One book *can* have several documents (matn PDF + sharḥ PDF + audio
   later), and reading state belongs to the book.

3. **`AnnotationAnchor` is 1:1 with annotation but its own row, versioned.**
   `anchorVersion` lets a future resolver upgrade old anchors in a migration
   without touching the annotation.

4. **Added `quoteRefs` — a derived join table.** This is the piece the brief's
   schema was missing. The brief says "a note may have several sources, a source
   may have several notes", but a `noteId` field on the annotation can't express
   that. Instead: source quotes live as nodes inside the note's ProseMirror doc,
   and every save re-derives `quoteRefs (annotationId, noteId, blockId)`. That
   gives a true many-to-many with the document as the single source of truth
   (no drift between doc content and join rows).

5. **`notes` split into `notes` (metadata) and `noteDocs` (ProseMirror JSON).**
   Same reason as documents: the sidebar lists 400 notes without parsing 400 docs.

6. **`normalizedText` is stored everywhere raw text is stored** — never instead
   of it. Normalisation is lossy; the original is scripture-adjacent data.

7. **`readingStates` keyed by bookId**, storing scroll *ratio* not pixels, so
   restoring works across window sizes and zoom levels.

### Tables

```
subjects        id, parentId, name, arabicName, icon, order, createdAt, updatedAt
books           id, subjectId, title, arabicTitle, author, arabicAuthor,
                publisher, edition, language, pageCount, tags[], favorite,
                order, createdAt, updatedAt, lastOpenedAt
documents       id, bookId, filename, byteLength, fingerprint(sha-256),
                pageCount, pdfFingerprint, createdAt
documentBlobs   documentId, blob                      ← bytes only
pages           id, documentId, pageNumber, text, normalizedText,
                width, height, rotation, hasTextLayer, textSource, indexedAt
outlineNodes    id, bookId, parentId, title, pageNumber, order, source
layers          id, bookId, name, teacher, color, visible, order       (P2, table live)
annotations     id, bookId, documentId, pageNumber, type, color,
                selectedText, normalizedText, layerId, lessonId,
                textSource, createdAt, updatedAt
anchors         id, annotationId, documentId, pageNumber,
                startOffset, endOffset, itemStart, itemEnd,
                occurrenceIndex, textBefore, textAfter,
                rects[normalised 0..1], pageWidth, pageHeight, pageRotation,
                anchorVersion
notes           id, bookId, title, outlineNodeId, lessonId, layerId,
                order, createdAt, updatedAt
noteDocs        noteId, doc(ProseMirror JSON), updatedAt
quoteRefs       id, annotationId, noteId, blockId          ← derived, many-to-many
readingStates   bookId, pageNumber, scrollRatio, zoom, layout,
                activeNoteId, updatedAt
appState        key, value                                  ← theme, panel sizes
bookmarks, tags, concepts, lessons, links   ← declared in schema v1, used in P2
```

### The spine

```
Book 1──n Document 1──n Page
                   │
                   └──n Annotation 1──1 Anchor
                              │
                              └──n QuoteRef n──1 Note ──1 NoteDoc
```

`QuoteRef` is what makes note↔passage genuinely bidirectional and many-to-many.

### Schema v2 (additive)

Three changes, none destructive:

| Change | Why |
|---|---|
| `noteLinks` store | `[[ ]]` references, derived from the note document on save by the same mechanism as `quoteRefs`. Unresolved targets are kept — writing `[[Ḥanīfiyyah]]` before that note exists is normal. |
| `assets` store | Images stored by reference. Inlining them as data URLs would re-serialise megabytes of base64 on every autosave. |
| `lessonId` index on `notes` | So a lesson can list its own notes. |

Only `notes` is re-declared (Dexie requires restating a store to change its
index list); its rows are re-indexed, never rewritten. `src/db/migration.test.ts`
builds a real v1 database, opens it with the current schema and asserts every
row, every Arabic string and every anchor survives.

### The source group

The most important structural addition since v1. A `sourceGroup` node contains
`sourceQuote block+` — a passage together with everything learned about it.

Before, a quotation and its explanation were merely adjacent. Now the
relationship lives in the document, which is what lets it survive reordering,
be collapsed or exported as a unit, and lets a future margin mode ask "what
belongs to this passage?" and get an answer from the tree rather than from a
guess about vertical position.

Backwards compatible by construction: `sourceQuote` is still a member of the
`block` group, so notes written before this node existed still parse, and
`collectQuoteRefs` already walked the tree recursively.

---

## C. Folder structure

```
src/
  app/                      App root, providers, theme boot
  features/                 vertical slices — UI only
    shell/    AppShell, TopBar, StatusBar, panel layout
    library/  tree, import dialog, book metadata
    pdf/      viewer, page, text layer, highlight layer, selection menu
    notes/    editor, extensions (sourceQuote, slash, islamic blocks)
    search/   in-book + library search panel
    command/  command palette
    shortcuts/ global keymap
  services/                 pure TS — no React imports allowed
    pdf/      pdfjs adapter, pageText, importer
    annotations/ AnnotationEngine, AnchorResolver, selection capture
    notes/    NotesService, quoteRef derivation
    search/   SearchEngine
    export/   ExportEngine
    ocr/      OCRProvider interface + NullOcrProvider
  db/         Dexie schema + repositories (only Dexie consumers)
  state/      zustand stores
  lib/        arabic.ts, dir.ts, hash.ts, id.ts, debounce.ts
  types/      domain types (single source of truth)
  test/       unit + integration tests
```

Constraint enforced by review: `features/**` may import `services/**`;
`services/**` may import `db/**` and `lib/**`; nothing imports upward.

---

## D. PDF strategy

**pdf.js 6.x**, used deliberately at a low level rather than via `pdf_viewer.mjs`,
because the bundled viewer's text layer and annotation editor fight a custom
anchoring system.

* Worker loaded as a Vite module URL — bundled, works offline.
* **Virtualised continuous scroll.** All page wrappers exist at correct height
  from page 1 (heights come from `getViewport` metadata, cheap). Only pages within
  ±1 viewport of the scrollport actually render canvas + text layer. Others are
  released. This is what keeps a 900-page book instant.
* Each rendered page = `<canvas>` + `TextLayer` (real selectable DOM) +
  highlight overlay `<div>`s positioned in **percentage** coordinates.
* Because highlights are percentage-based, zoom/resize needs no recomputation.
* **The original PDF blob is never mutated.** Annotations are application rows.
  Export writes new files; import bytes are immutable and hashed.
* Page text is extracted once at import (async, page by page, non-blocking) into
  `pages`. The user can read page 1 while page 400 is still indexing.

### Canonical page text — the keystone

Both the importer and the live text layer derive page text with **one shared
function**:

```ts
buildPageText(textContent) →
  items.filter(it => it.str !== undefined)
       .map(it => it.str + (it.hasEOL ? '\n' : ''))
       .join('')
```

pdf.js's `TextLayer` skips exactly the same items (`str === undefined` are
marked-content markers), so `textLayer.textDivs[i]` corresponds 1:1 to filtered
item `i`. Each rendered span is tagged `data-i={i}`, and we precompute
`itemStartOffsets[i]`. A DOM selection therefore converts to a **character offset
into the same string that was indexed at import time** — the two views can never
disagree.

---

## E. Annotation & anchoring strategy

A selection is captured as a **redundant, over-specified anchor**. Any one signal
may rot; the resolver only needs one to survive.

**Captured at selection time**

| Signal | Purpose |
|---|---|
| `pageNumber` | coarse locator |
| `startOffset` / `endOffset` | exact position in canonical page text |
| `itemStart` / `itemEnd` | survives offset drift if text extraction changes |
| `selectedText` (raw) | the sacred original — never normalised in place |
| `normalizedText` | matching under diacritic/alif/hamzah variation |
| `textBefore` / `textAfter` (64 chars) | disambiguates repeated sentences |
| `occurrenceIndex` | *which* of N identical matches on this page |
| `rects[]` in 0..1 page space | geometric fallback + rendering, zoom-free |
| `pageWidth/Height/Rotation` | interpret rects if geometry changes |

**Resolution cascade** (`AnchorResolver.resolve`), each step returns a
confidence:

1. `exact` — offsets still yield the same normalised text. *(confidence 1.0)*
2. `context` — find `textBefore + selected + textAfter` in the page. *(0.95)*
3. `occurrence` — Nth normalised occurrence on the page. *(0.85)*
4. `unique` — normalised text appears exactly once on the page. *(0.8)*
5. `neighbour` — same, searching pages ±2 (reflow / re-import). *(0.6)*
6. `geometric` — stored rects only; text lost (e.g. text layer removed). *(0.3)*
7. `unresolved` — surface a quiet badge on the quote. **Never delete the note.**

Steps 2–5 need to map a match in *normalised* space back to *raw* offsets, so
`normalizeArabic` returns `{ text, map }` where `map[i]` is the source index of
normalised char `i`. This is the reason normalisation is written by hand rather
than as a chain of `String.replace` calls.

**The engine is the only writer.** UI never inserts an annotation row. This keeps
the `quoteRefs` index and the highlight layer consistent by construction.

---

## F. Editor strategy

**Tiptap 3 / ProseMirror.** Chosen over Lexical/Slate because ProseMirror's
schema is a real grammar: `sourceQuote` can be declared *atomic, non-editable,
draggable, with attributes* and the editor then structurally guarantees the user
cannot corrupt a quotation by typing into it. That guarantee is the product.

* `sourceQuote` — atom node, attrs `{ annotationId }` only. Everything displayed
  (Arabic text, book title, page, ↗) is rendered by a React NodeView that reads
  from the store. Renaming a book updates every quotation everywhere, for free.
* **On insert, the plugin places the cursor in a fresh paragraph *below* the
  quote and focuses the editor.** This is the 2-second workflow; it is one
  transaction, no `setTimeout`, no modal.
* Islamic semantic blocks (`fa'idah`, `mas'alah`, `qa'idah`, `evidence`,
  `teacher`, `question`, `definition`, `important`, `warning`, `khilaf`,
  `scholar`, `quran`, `hadith`, `athar`) are **one** node type
  `semanticBlock` with a `kind` attribute — not 14 node types. Adding a new kind
  is a config line, not a schema migration.
* Slash menu and `[[` menu use one shared `suggestion` infrastructure.
* Autosave: debounce 400 ms + flush on blur, on route change, and on
  `visibilitychange`/`pagehide`. Writes go to `noteDocs` and re-derive `quoteRefs`
  in the same Dexie transaction.

---

## G. Arabic / RTL strategy

Treated as a first-class script, not a compatibility mode.

* **Storage** — text stored exactly as extracted, NFC only where the PDF gave us
  compatibility forms; presentation forms (U+FB50–U+FEFF) are decomposed on
  *index* but the raw string is kept untouched alongside.
* **Direction** — per block. `detectDirection` scans for the first strong
  bidirectional character (Arabic/Hebrew ranges vs Latin), skipping digits,
  punctuation and whitespace. Applied as `dir="rtl|ltr"` on the block element, so
  the browser's own bidi algorithm handles mixed runs, brackets and Latin digits
  correctly. A manual override attribute wins when set.
* **Never** `direction: rtl` on a container that holds both scripts — that
  breaks parenthesis mirroring. Direction is always per-paragraph.
* **Search normalisation profile** (opt-in, default on for search only):
  strip tashkīl `U+064B–U+0652, U+0670, U+0640 (tatwīl), U+06D6–U+06ED`,
  fold `آ أ إ ٱ → ا`, `ى → ي`, `ة → ه`, `ؤ → و`, `ئ → ي`,
  map Arabic-Indic digits `٠-٩ / ۰-۹ → 0-9`,
  collapse whitespace, decompose presentation forms.
  Every transformation maintains the index map so highlights land on the right
  raw characters.
* **Fonts** — Amiri (self-hosted, offline) for Arabic body text; Inter Variable
  for UI. The **PDF is never restyled** — it renders exactly as authored.
* Copy from a quotation yields the raw stored string, diacritics intact.

---

## H. Local storage strategy

* **Dexie 4 / IndexedDB**, one database `hashiyah`, versioned migrations.
* PDF bytes stored as `Blob` in `documentBlobs`. Chrome/Edge store these on disk,
  not in memory — a 40 MB book costs ~0 RAM until opened.
* `navigator.storage.persist()` requested on first import so the browser will not
  evict the library under storage pressure. Quota surfaced in Settings.
* Everything works offline. There is no server in Phase 1 — not "a server that
  happens to be down", literally no network call in the reading path.
* All writes are transactional per logical operation. An annotation + its anchor
  are written in one `rw` transaction; a partial anchor can never exist.
* Autosave everywhere; no Save button anywhere in the UI.

---

## I. Wireframes

### Study screen (default, three panels)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ḥ  Ḥāshiyah   ⌘K Search or run a command…        ⌘⇧L Lesson  ◐ Theme  ⚙     │
├─────────────────┬──────────────────────────────────┬─────────────────────────┤
│ LIBRARY      +  │  UṢŪL ATH-THALĀTHAH              │ NOTES              +    │
│ ─────────────── │  ‹ 4 / 28 ›   − 125% +   ⤢  ⌕    │ ──────────────────────  │
│ ⌕ Filter…       │ ┌──────────────────────────────┐ │ Millat Ibrāhīm      ⌄   │
│                 │ │                              │ │                         │
│ ▾ ʿAqīdah       │ │      Arabic page renders     │ │ ▎الحنيفية ملة إبراهيم    │
│   Important…    │ │      exactly as authored     │ │ ▎Uṣūl ath-Thal. · p.4 ↗ │
│   Conditions…   │ │                              │ │                         │
│   ▾ Uṣūl ath-…  │ │  ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ ◄──────────┼─┼── Hanifiyyah means      │
│      Four Mat…  │ │  highlighted passage         │ │    turning away from    │
│      Millat I…  │ │                              │ │    shirk toward tawḥīd. │
│ ▾ Fiqh          │ │                              │ │                         │
│   Manhaj as-…   │ │                              │ │ FĀʾIDAH                 │
│ ▸ Ḥadīth        │ └──────────────────────────────┘ │ ▎ The author begins…    │
│ ▸ Tafsīr        │                                  │                         │
├─────────────────┴──────────────────────────────────┴─────────────────────────┤
│ Uṣūl ath-Thalāthah · p. 4          Saved ✓            3 notes on this page   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Selection menu (appears on text selection, ~2px above selection)

```
        ┌───────────────────────────────────────────────────────┐
        │ ✎ Explain ⌘E │ ▤ Highlight ⌘H │ ★ Fāʾidah │ ≡ Def. │⋯│
        └───────────────────────────────────────────────────────┘
```
Order is by frequency. `Explain` is first and is also the shortcut default.

### Lesson mode

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                          ● 00:14:32   Esc ⤶  │
├───────────────────────────────────────────┬──────────────────────────────────┤
│                                           │  ▎الحنيفية ملة إبراهيم            │
│            Arabic page                    │  ▎p.4 ↗                          │
│            (library hidden,               │                                  │
│             chrome reduced,               │  Ustādh explained that…│          │
│             toolbar auto-hides)           │                                  │
│                                           │                                  │
└───────────────────────────────────────────┴──────────────────────────────────┘
```

### Margin mode (Phase 2)

```
   BOOK                                        MARGIN
   قال المصنف رحمه الله …    ────────────────  Teacher explained …
   الحنيفية ملة إبراهيم      ────────────────  Definition of ḥanīfiyyah
   وأن تعبد الله وحده        ────────────────  Important point
                                                ↳ related evidence
```
Notes are absolutely positioned at the vertical centroid of their anchor's rects,
then run through a collision solver that pushes overlapping cards downward and
draws a 1px connector when a card is displaced more than 8px.

---

## J. MVP milestones

| # | Milestone | Done when |
|---|---|---|
| 1 | Foundations | Types, Dexie schema, Arabic lib, all with passing unit tests |
| 2 | Shell | Three resizable panels, dark/light, persisted layout, status bar |
| 3 | Library | Subject/book tree, drag-free ordering, import dialog, persistence |
| 4 | PDF import | Drop a PDF → blob + metadata stored → background text indexing |
| 5 | Reader | Virtualised continuous scroll, zoom, page nav, restore position |
| 6 | Selection | Text layer offset mapping, selection menu, Arabic selection correct |
| 7 | Annotations | Highlights persist, render at any zoom, click to select |
| 8 | Editor | Tiptap with headings/lists/toggles/semantic blocks, RTL per block |
| 9 | **Extract & Explain** | ⌘E → quote block + focused cursor beneath, < 100 ms |
| 10 | Bidirectional nav | quote → source (scroll + pulse); highlight → notes |
| 11 | Persistence | Full reload survives: books, notes, anchors, position |
| 12 | Search | In-book, in-notes, library — grouped, Arabic-normalised |
| 13 | Palette + keymap | ⌘K, all Phase-1 shortcuts |
| 14 | Acceptance | The §59 workflow, end to end, twice, after a hard reload |

---

## K. Technical risks

| Risk | Severity | Mitigation |
|---|---|---|
| Arabic PDFs with no text layer (scans) | High — very common | Detect at import (`text.length / pageCount` threshold), badge the book "Image-only", disable Extract & Explain for those pages with an honest message rather than a broken selection. `OCRProvider` seam already in place. |
| pdf.js text item order ≠ visual order in RTL | High | We anchor to *logical* offsets from `getTextContent`, not visual order, so anchors are stable regardless. Highlight rects come from DOM range rects, which the browser computes correctly for RTL. |
| Selection spanning multiple text items / lines | Medium | Anchor stores start/end item **and** offsets; rects come from `Range.getClientRects()` which yields one rect per line — stored as an array. |
| IndexedDB eviction losing a library | High | `navigator.storage.persist()`, quota display, and full JSON+blob export from day one. |
| Tiptap doc corruption losing notes | High | Zod-validate the PM doc before every write; on failure keep the last-known-good and surface an error rather than overwriting. |
| Large books stalling the UI during indexing | Medium | Indexing is page-at-a-time, yielded via `requestIdleCallback`/`setTimeout(0)`, cancellable, and progress-reported. Reading never waits on it. |
| Anchor rot after re-importing a different edition | Medium | Document `fingerprint` compared on import; a differing hash creates a *new* document and the UI offers to migrate anchors by text matching rather than silently mis-resolving. |
| OneDrive-synced `node_modules` on this machine | Low, local | Dev only; noted, not blocking. |

---

## Non-goals for Phase 1 (deliberately not built, not faked)

OCR · handwriting/Apple Pencil · margin mode · workspace canvas · commentary
layers · lessons · backlinks/`[[ ]]` · knowledge base · cloud sync · version
history · AI. Where these appear in the UI at all, they are visibly disabled and
labelled *Phase 2* / *Phase 3*. No enabled control is a placeholder.
