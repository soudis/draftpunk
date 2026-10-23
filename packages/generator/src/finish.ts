import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function htmlFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'media' ? [] : htmlFiles(file)
    return entry.name.endsWith('.html') ? [file] : []
  })
}

/**
 * The stylesheet gets a name that holds its content, /assets/styles.3fa9c01b22.css, and every page links to that name.
 * A browser can then keep it for good, and a changed stylesheet is a new name. The plain name stays for anything that still uses it.
 */
export function fingerprintStyles(outDir: string): string | undefined {
  const plain = path.join(outDir, 'assets', 'styles.css')
  if (!fs.existsSync(plain)) return undefined
  const css = fs.readFileSync(plain)
  const name = `styles.${crypto.createHash('sha256').update(css).digest('hex').slice(0, 10)}.css`
  fs.writeFileSync(path.join(outDir, 'assets', name), css)
  for (const file of htmlFiles(outDir)) {
    const html = fs.readFileSync(file, 'utf8')
    const next = html.replaceAll('href="/assets/styles.css"', `href="/assets/${name}"`)
    if (next !== html) fs.writeFileSync(file, next)
  }
  return name
}
