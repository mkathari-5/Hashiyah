import { db } from '@/db/db'
import { libraryRepo } from '@/db/repos/libraryTree'
import { notesRepo } from '@/db/repos/notes'
import { normalizeForSearch } from '@/lib/arabic'
import type { LibraryNode } from '@/types'
export type { LibraryNode }

/**
 * Populating the library tree (§E2, §E3, §E6, §E7).
 *
 * Runs on every start and must therefore be **idempotent**: running it twice
 * must never produce "ʿAqīdah, ʿAqīdah, ʿAqīdah". Idempotency here is
 * structural rather than flag-based — each step checks for what it would create
 * and skips if it is already there — so it stays correct even if a flag is lost
 * or a previous run was interrupted half-way.
 *
 * It is a normal transaction, not a Dexie upgrade callback. An upgrade callback
 * that throws leaves the schema version bumped and the data half-migrated;
 * doing this afterwards means a failure leaves the tree merely incomplete, and
 * the next start finishes the job.
 */

export const DEFAULT_SCIENCES: { title: string; arabicTitle?: string }[] = [
  { title: 'ʿAqīdah and Uṣūl ad-Dīn', arabicTitle: 'العقيدة وأصول الدين' },
  { title: 'Fiqh and Uṣūl al-Fiqh', arabicTitle: 'الفقه وأصول الفقه' },
  { title: "Tafsīr and ʿUlūm al-Qurʾān", arabicTitle: 'التفسير وعلوم القرآن' },
  { title: 'Ḥadīth and ʿUlūm al-Ḥadīth', arabicTitle: 'الحديث وعلوم الحديث' },
  { title: 'Sīrah and History', arabicTitle: 'السيرة والتاريخ' },
  { title: 'Arabic Language', arabicTitle: 'اللغة العربية' },
  { title: 'Books for the Heart', arabicTitle: 'كتب القلوب' },
]

/** Match on normalised titles so ʿAqīdah and Aqidah are not treated as different. */
function sameTitle(a: string, b: string) {
  return normalizeForSearch(a) === normalizeForSearch(b)
}

export interface BootstrapResult {
  createdSciences: number
  migratedSubjects: number
  linkedBooks: number
  alreadyPresent: boolean
  /** Nodes merged away by the repair pass. Should be 0 on a healthy library. */
  repairedDuplicates: number
}

/**
 * Repairs a library that already contains duplicates.
 *
 * Two nodes are the same entry if they sit under the same parent, are the same
 * type, and share a normalised title — or, for books, point at the same Book.
 * The oldest is kept, anything hanging off a duplicate is re-parented onto the
 * keeper, and only genuinely empty duplicates are deleted. Nothing that holds
 * notes or children is ever discarded.
 */
async function deduplicate(): Promise<number> {
  const all = await libraryRepo.all()
  if (all.length === 0) return 0

  const keyOf = (node: LibraryNode) =>
    node.bookId
      ? `book:${node.bookId}`
      : `${node.parentId ?? 'root'}:${node.type}:${normalizeForSearch(node.title)}`

  const groups = new Map<string, LibraryNode[]>()
  for (const node of all) {
    const list = groups.get(keyOf(node)) ?? []
    list.push(node)
    groups.set(keyOf(node), list)
  }

  const childCount = new Map<string, number>()
  for (const node of all) {
    if (node.parentId) childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1)
  }

  /**
   * Which of a duplicate pair to keep.
   *
   * Content first: the node the reader actually put things under wins, so
   * repairing never strands a book or a set of notes. Only then oldest, and
   * finally id — because two nodes created in the same millisecond tie on
   * `createdAt`, and without a final deterministic key the winner would be
   * whichever random id happened to sort first.
   */
  const weight = (node: LibraryNode) =>
    (node.noteId ? 2 : 0) + (childCount.get(node.id) ? 1 : 0)

  let removed = 0
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const [keeper, ...duplicates] = group.sort(
      (a, b) => weight(b) - weight(a) || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    )

    for (const duplicate of duplicates) {
      const children = all.filter((n) => n.parentId === duplicate.id)
      for (const child of children) {
        await db.libraryNodes.update(child.id, { parentId: keeper.id, updatedAt: Date.now() })
        child.parentId = keeper.id
      }
      // A duplicate that accumulated its own notes is kept rather than dropped.
      if (duplicate.noteId && !keeper.noteId) {
        await db.libraryNodes.update(keeper.id, { noteId: duplicate.noteId })
        keeper.noteId = duplicate.noteId
        await db.libraryNodes.delete(duplicate.id)
        removed += 1
      } else if (!duplicate.noteId) {
        await db.libraryNodes.delete(duplicate.id)
        removed += 1
      }
    }
  }

  return removed
}

/**
 * Single-flight guard.
 *
 * React's StrictMode invokes start-up effects twice, and two tabs can open at
 * once. Without this, two concurrent runs both read an empty table and both
 * create the full default set — which is precisely the "ʿAqīdah, ʿAqīdah,
 * ʿAqīdah" failure §E3 warns about. Sharing one promise handles the common
 * case; the transaction below handles the rest.
 */
let inFlight: Promise<BootstrapResult> | null = null

export function bootstrapLibrary(): Promise<BootstrapResult> {
  if (!inFlight) {
    inFlight = runBootstrap().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

async function runBootstrap(): Promise<BootstrapResult> {
  /**
   * The whole check-and-create runs in **one** read-write transaction.
   *
   * Idempotency by "read the table, then create what is missing" is a
   * check-then-act race: concurrent callers each see an empty table. IndexedDB
   * serialises readwrite transactions over the same stores, so doing the read
   * and the writes together makes the second caller observe the first's work.
   */
  return db.transaction('rw', db.libraryNodes, db.subjects, db.books, db.notes, () =>
    bootstrapWithin(),
  )
}

async function bootstrapWithin(): Promise<BootstrapResult> {
  const result: BootstrapResult = {
    createdSciences: 0,
    migratedSubjects: 0,
    linkedBooks: 0,
    alreadyPresent: false,
    repairedDuplicates: 0,
  }

  // Repair anything an earlier, racier run left behind before deciding what is
  // missing — otherwise duplicates would be treated as "already present".
  result.repairedDuplicates = await deduplicate()

  const existing = await libraryRepo.all()
  const [subjects, books] = await Promise.all([db.subjects.toArray(), db.books.toArray()])

  // ── 1. Carry any pre-existing subjects across, once ──────────────────────
  // A reader who already organised their library keeps that organisation; we
  // do not impose the defaults on top of it.
  const scienceNodes = existing.filter((n) => n.type === 'science' || n.type === 'folder')
  const bySubjectTitle = new Map<string, LibraryNode>()
  for (const node of scienceNodes) bySubjectTitle.set(normalizeForSearch(node.title), node)

  for (const subject of subjects.sort((a, b) => a.order - b.order)) {
    if (bySubjectTitle.has(normalizeForSearch(subject.name))) continue
    const node = await libraryRepo.create({
      parentId: null,
      type: 'science',
      title: subject.name,
      arabicTitle: subject.arabicName,
    })
    bySubjectTitle.set(normalizeForSearch(subject.name), node)
    result.migratedSubjects += 1
  }

  // ── 2. Seed the default sciences only for a library that has none ────────
  if (bySubjectTitle.size === 0) {
    for (const science of DEFAULT_SCIENCES) {
      const node = await libraryRepo.create({
        parentId: null,
        type: 'science',
        title: science.title,
        arabicTitle: science.arabicTitle,
      })
      bySubjectTitle.set(normalizeForSearch(science.title), node)
      result.createdSciences += 1
    }
  } else {
    // Fill in any default that is genuinely absent, without disturbing order.
    for (const science of DEFAULT_SCIENCES) {
      if ([...bySubjectTitle.keys()].some((key) => sameTitle(key, science.title))) continue
      const node = await libraryRepo.create({
        parentId: null,
        type: 'science',
        title: science.title,
        arabicTitle: science.arabicTitle,
      })
      bySubjectTitle.set(normalizeForSearch(science.title), node)
      result.createdSciences += 1
    }
  }

  // ── 3. Give every existing book a node, exactly once (§E6) ───────────────
  // The Book record is referenced, never copied: its PDF, pages, annotations
  // and anchors stay exactly where they are.
  const linked = new Set(existing.map((n) => n.bookId).filter((id): id is string => !!id))

  for (const book of books.sort((a, b) => a.order - b.order)) {
    if (linked.has(book.id)) continue

    let parentId: string | null = null
    if (book.subjectId) {
      const subject = subjects.find((s) => s.id === book.subjectId)
      if (subject) parentId = bySubjectTitle.get(normalizeForSearch(subject.name))?.id ?? null
    }
    // An unfiled book still belongs somewhere findable.
    if (!parentId) {
      const fallback = [...bySubjectTitle.values()][0]
      parentId = fallback?.id ?? null
    }

    await libraryRepo.create({
      parentId,
      type: 'book',
      title: book.title,
      arabicTitle: book.arabicTitle,
      bookId: book.id,
    })
    linked.add(book.id)
    result.linkedBooks += 1
  }

  result.alreadyPresent =
    existing.length > 0 &&
    result.createdSciences === 0 &&
    result.migratedSubjects === 0 &&
    result.linkedBooks === 0 &&
    result.repairedDuplicates === 0

  return result
}

/**
 * The stable notes document for a node (§E5, §E10, §E11, §E45).
 *
 * Created on first open and remembered thereafter, so clicking a chapter
 * tomorrow reopens the same notes rather than starting a blank one. Uses the
 * existing notes system — there is no second notes implementation.
 */
export async function ensureNodeNote(nodeId: string): Promise<string | null> {
  const node = await libraryRepo.get(nodeId)
  if (!node) return null
  if (node.noteId) {
    // Guard against a dangling reference if the note was deleted elsewhere.
    const existing = await notesRepo.get(node.noteId)
    if (existing) return node.noteId
  }

  const note = await notesRepo.create({
    bookId: node.bookId ?? null,
    title: node.arabicTitle ? `${node.title} — ${node.arabicTitle}` : node.title,
  })
  await libraryRepo.update(nodeId, { noteId: note.id })
  return note.id
}
