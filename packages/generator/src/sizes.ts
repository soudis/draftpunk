import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The widths a picture is offered in. A browser takes the smallest one that is enough for its screen. */
export const SIZE_WIDTHS = [480, 960, 1600]
/** A picture that is small already is left as it is. */
const SMALLEST_FILE = 40_000
const FOLDER = 'media/_sizes'

type Job = { source: string; name: string; width: number }

/** Where the sharp package is, or null: without it a site is made without smaller copies of its pictures. */
function sharpPath(): string | null {
  const starts: (() => string)[] = [() => path.join(process.cwd(), 'noop.js'), () => fileURLToPath(import.meta.url)]
  for (const start of starts) {
    try {
      return createRequire(start()).resolve('sharp')
    } catch {
      continue
    }
  }
  return null
}

// Runs in its own process, so that the generator stays synchronous. Smaller copies are made four at a time.
const RESIZE_SOURCE = `
const fs = require('fs')
const data = JSON.parse(fs.readFileSync(0, 'utf8'))
const sharp = require(data.sharp)
const failed = []
let next = 0
const worker = async () => {
  while (next < data.jobs.length) {
    const job = data.jobs[next++]
    try {
      const meta = await sharp(job.source, { failOn: 'none' }).metadata()
      if ((meta.pages || 1) > 1) { failed.push(job.name); continue }
      await sharp(job.source, { failOn: 'none' }).rotate().resize({ width: job.width, withoutEnlargement: true }).webp({ quality: 76 }).toFile(job.dest + '.part.webp')
      fs.renameSync(job.dest + '.part.webp', job.dest)
    } catch (error) {
      failed.push(job.name)
    }
  }
}
Promise.all([worker(), worker(), worker(), worker()]).then(() => console.log(JSON.stringify(failed)))
`

/**
 * Smaller copies of a site's pictures. The generator plans them while it writes pages, so a picture's address and
 * its `srcset` are in the page; the copies are made at the end, and kept between runs (a copy is named by the picture's
 * file, its time and its size, so a changed picture gets new copies and an unchanged one is never made twice).
 */
export class SizePlan {
  private jobs = new Map<string, Job>()
  private sharp = sharpPath()

  constructor(private root: string) {}

  /** The address to load and the `srcset` for a picture of the site, or null when it is better left alone. */
  plan(address: string, size: { width: number; height: number } | null): { src: string; srcset: string } | null {
    if (!this.sharp || !size) return null
    const clean = address.split(/[?#]/)[0]
    if (!/^\/media\/(?!_sizes\/).+\.(?:jpe?g|png|webp)$/i.test(clean) || clean.includes('..')) return null
    const source = path.join(this.root, clean.slice(1))
    let stat: fs.Stats
    try {
      stat = fs.statSync(source)
    } catch {
      return null
    }
    if (stat.size < SMALLEST_FILE) return null
    const widths = SIZE_WIDTHS.filter((width) => width <= size.width * 0.85)
    if (widths.length === 0) return null
    const key = crypto.createHash('sha1').update(`${clean}\0${Math.round(stat.mtimeMs)}\0${stat.size}`).digest('hex').slice(0, 8)
    const stem = clean.slice('/media/'.length).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
    const entries = widths.map((width) => {
      const name = `${stem}-${width}-${key}.webp`
      this.jobs.set(name, { source, name, width })
      return { width, url: `/${FOLDER}/${name}` }
    })
    const biggest = entries[entries.length - 1]
    // A picture much wider than the widest copy loads that copy; one that is not, loads itself.
    const original = size.width > SIZE_WIDTHS[SIZE_WIDTHS.length - 1] && biggest.width === SIZE_WIDTHS[SIZE_WIDTHS.length - 1] ? null : { width: size.width, url: clean }
    const all = original ? [...entries, original] : entries
    return { src: original ? clean : biggest.url, srcset: all.map((entry) => `${entry.url} ${entry.width}w`).join(', ') }
  }

  /** Make the copies a site's pages ask for, and put them in the output. A copy that cannot be made is the picture itself, so no address is ever missing. */
  write(outDir: string): void {
    if (this.jobs.size === 0) return
    const cache = cacheFolder(this.root)
    fs.mkdirSync(cache, { recursive: true })
    const missing = [...this.jobs.values()].filter((job) => !fs.existsSync(path.join(cache, job.name)))
    if (missing.length > 0 && this.sharp) {
      spawnSync(process.execPath, ['-e', RESIZE_SOURCE], {
        input: JSON.stringify({ sharp: this.sharp, jobs: missing.map((job) => ({ ...job, dest: path.join(cache, job.name) })) }),
        encoding: 'utf8',
        timeout: 600_000,
        maxBuffer: 16 * 1024 * 1024,
      })
    }
    const target = path.join(outDir, FOLDER)
    fs.mkdirSync(target, { recursive: true })
    for (const job of this.jobs.values()) {
      const made = path.join(cache, job.name)
      fs.copyFileSync(fs.existsSync(made) ? made : job.source, path.join(target, job.name))
    }
  }
}

/** Kept inside the site's git folder when it has one (which git does not track), else in the temporary folder. */
function cacheFolder(root: string): string {
  const git = path.join(root, '.git')
  try {
    if (fs.statSync(git).isDirectory()) return path.join(git, 'schlor-sizes')
  } catch {
    // not a git folder
  }
  return path.join(os.tmpdir(), 'schlor-sizes', crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 10))
}
