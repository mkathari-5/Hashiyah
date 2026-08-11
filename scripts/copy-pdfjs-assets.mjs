/**
 * Copies pdf.js runtime assets (cmaps, standard fonts, wasm decoders, ICC
 * profiles) into `public/pdfjs` so the reader never touches the network.
 * Run automatically before dev and build.
 */
import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'node_modules', 'pdfjs-dist')
const dest = path.join(root, 'public', 'pdfjs')

const DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs']

await mkdir(dest, { recursive: true })
for (const dir of DIRS) {
  const from = path.join(src, dir)
  if (!existsSync(from)) {
    console.warn(`[pdfjs-assets] skipping missing ${dir}`)
    continue
  }
  const to = path.join(dest, dir)
  await rm(to, { recursive: true, force: true })
  await cp(from, to, { recursive: true })
}
console.log(`[pdfjs-assets] copied ${DIRS.join(', ')} → public/pdfjs`)
