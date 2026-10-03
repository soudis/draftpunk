import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generate, seedDirectory } from '@schlor/generator'
import { importWordPress } from './import'

const root = path.resolve(process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../instances/schlor'))
const result = await importWordPress(root)
const generated = generate(root)
const seed = seedDirectory()
fs.copyFileSync(path.join(root, 'design', 'nav.yml'), path.join(seed, 'design', 'nav.yml'))
const logo = path.join(root, 'media', 'logo.png')
if (fs.existsSync(logo)) {
  fs.mkdirSync(path.join(seed, 'media'), { recursive: true })
  fs.copyFileSync(logo, path.join(seed, 'media', 'logo.png'))
}
console.log(`Imported ${result.pages} pages, ${result.news} news items, ${result.events} event series, ${result.images} images into ${root}`)
console.log(`Generated ${generated.pages} language pages and ${generated.events} events`)
