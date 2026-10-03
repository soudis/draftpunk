import path from 'node:path'
import { generate } from './generate'

const root = process.argv[2]
if (!root) {
  console.error('Usage: generate <site-root> [out-dir]')
  process.exit(1)
}
const result = generate(path.resolve(root), process.argv[3] ? path.resolve(process.argv[3]) : undefined)
console.log(`Generated ${result.pages} language pages and ${result.events} events into ${result.outDir}`)
