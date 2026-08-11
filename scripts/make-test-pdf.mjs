/**
 * Generates a synthetic Arabic PDF fixture for manual and end-to-end testing.
 *
 * This is NOT a real book — it is a deliberately awkward test case:
 *   - the target phrase appears three times, twice on the same page, so the
 *     anchor's occurrence disambiguation is actually exercised
 *   - page 3 carries the phrase fully vocalised, so search and resolution have
 *     to fold diacritics to find it
 *   - one page mixes Arabic and English in the same paragraph
 *
 * Run: node scripts/make-test-pdf.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'test-fixtures')

const PAGES = [
  [
    'الأصول الثلاثة',
    'بسم الله الرحمن الرحيم',
    'اعلم رحمك الله أنه يجب علينا تعلم أربع مسائل',
    'الأولى: العلم، وهو معرفة الله ومعرفة نبيه ومعرفة دين الإسلام بالأدلة',
  ],
  [
    'المسألة الثانية: العمل به',
    'الثالثة: الدعوة إليه',
    'الرابعة: الصبر على الأذى فيه',
    'قال المصنف رحمه الله: الحنيفية ملة إبراهيم',
    'وهي أن تعبد الله وحده مخلصا له الدين',
    'ثم أعاد المصنف فقال: الحنيفية ملة إبراهيم مرة أخرى في هذا الموضع',
  ],
  [
    'ٱلْحَنِيفِيَّةُ مِلَّةُ إِبْرَاهِيمَ عَلَيْهِ ٱلسَّلَامُ',
    'وبهذا يعلم أن التوحيد هو أصل الدين وأساسه',
    'صفحة ٣ من هذا الكتاب',
  ],
  [
    'The author begins by mentioning الحنيفية and its meaning in English too',
    'Mixed direction paragraphs must survive both extraction and search',
    'Page four of the fixture',
  ],
  ['خاتمة الكتاب', 'والحمد لله رب العالمين'],
]

const pdf = await PDFDocument.create()
pdf.registerFontkit(fontkit)
pdf.setTitle('Uṣūl ath-Thalāthah (test fixture)')
pdf.setAuthor('Test fixture')

const font = await pdf.embedFont(await readFile('C:/Windows/Fonts/arial.ttf'), { subset: true })

for (const lines of PAGES) {
  const page = pdf.addPage([595, 842])
  let y = 760
  lines.forEach((line, index) => {
    const size = index === 0 ? 20 : 13
    const width = font.widthOfTextAtSize(line, size)
    page.drawText(line, {
      x: Math.max(50, 545 - width), // right-aligned, as an Arabic book would be
      y,
      size,
      font,
      color: rgb(0.1, 0.1, 0.1),
    })
    y -= index === 0 ? 46 : 30
  })
}

await mkdir(out, { recursive: true })
const file = path.join(out, 'usul-ath-thalathah-fixture.pdf')
await writeFile(file, await pdf.save())
console.log(`wrote ${file}`)
