import fs from 'node:fs'
import path from 'node:path'
import { fail } from './tool-kit'

const MAX_RULES = 30
const HEADING = '# Rules'

function file(root: string): string {
  return path.join(root, 'design', 'rules.md')
}

/** The lasting preferences of the person, one line each. */
export function readRules(root: string): string[] {
  if (!fs.existsSync(file(root))) return []
  return fs
    .readFileSync(file(root), 'utf8')
    .split('\n')
    .map((line) => /^\s*[-*]\s+(.*\S)\s*$/.exec(line)?.[1])
    .filter((line): line is string => Boolean(line))
}

export function addRule(root: string, rule: string): { rules: string[]; added: boolean } {
  const line = rule.replace(/\s+/g, ' ').trim().replace(/^[-*]\s+/, '')
  if (line.length < 8) fail('A rule is one clear line, such as “Buttons are always square.”')
  if (line.length > 180) fail('A rule is one short line, under 180 characters. Say it in fewer words, or add two rules.')
  const rules = readRules(root)
  if (rules.some((existing) => existing.toLowerCase() === line.toLowerCase())) return { rules, added: false }
  if (rules.length >= MAX_RULES) fail(`There are already ${MAX_RULES} rules. Merge or remove some with write_design on rules.md first.`)
  const next = [...rules, line]
  fs.mkdirSync(path.dirname(file(root)), { recursive: true })
  fs.writeFileSync(file(root), `${HEADING}\n${next.map((item) => `- ${item}`).join('\n')}\n`)
  return { rules: next, added: true }
}
