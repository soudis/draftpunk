import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateText, type LanguageModel, type ModelMessage } from 'ai'
import { bilingualGaps, initSite } from '@schlor/generator'
import { agentRun } from './agent'
import { commitAll, ensureGit, filesChangedSince, git } from './git'
import { designContentRefusal, namedPages } from './layout-guard'
import type { EditorMode } from './mode'
import { stepTools } from './usage-log'

export type Check = { name: string; ok: boolean; detail?: string }

export type Scenario = {
  id: string
  title: string
  /** Needs the public internet. Skipped unless asked for. */
  network?: boolean
  mode?: EditorMode
  /** One user message per turn. */
  turns: string[]
  prepare: (root: string) => void
  checks: (context: { root: string; base: string; changed: string[] }) => Check[]
}

export type Prices = { input: number; cachedInput: number; output: number }

export type EvalResult = {
  scenario: string
  model: string
  seconds: number
  turns: number
  steps: number
  toolCalls: number
  toolFailures: number
  failures: { name: string; error: string }[]
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  cost?: number
  finalText: string
  changed: string[]
  checks: Check[]
}

const AUTHOR = { name: 'eval', email: 'eval@schlor.org' }

export async function runScenario(
  model: LanguageModel,
  scenario: Scenario,
  options: { modelName: string; root?: string; prices?: Prices } = { modelName: 'model' },
): Promise<EvalResult> {
  const root = options.root ?? fs.mkdtempSync(path.join(os.tmpdir(), `schlor-eval-${scenario.id}-`))
  initSite(root)
  scenario.prepare(root)
  ensureGit(root, AUTHOR)
  commitAll(root, 'Scenario start', AUTHOR)
  const base = revision(root)
  const started = Date.now()
  const messages: ModelMessage[] = []
  const failures: EvalResult['failures'] = []
  let steps = 0
  let calls = 0
  let input = 0
  let cached = 0
  let output = 0
  let finalText = ''
  for (const turn of scenario.turns) {
    messages.push({ role: 'user', content: turn })
    const result = await generateText({ model, ...agentRun(scenario.mode ?? 'edit', root), messages })
    for (const step of result.steps) {
      steps += 1
      input += step.usage.inputTokens ?? 0
      cached += step.usage.cachedInputTokens ?? 0
      output += step.usage.outputTokens ?? 0
      for (const tool of stepTools(step.content)) {
        calls += 1
        if (tool.error) failures.push({ name: tool.name, error: tool.error })
      }
    }
    messages.push(...result.response.messages)
    finalText = result.text
    commitAll(root, turn, AUTHOR)
  }
  const changed = filesChangedSince(root, base)
  const prices = options.prices
  return {
    scenario: scenario.id,
    model: options.modelName,
    seconds: (Date.now() - started) / 1000,
    turns: scenario.turns.length,
    steps,
    toolCalls: calls,
    toolFailures: failures.length,
    failures,
    inputTokens: input,
    cachedInputTokens: cached,
    outputTokens: output,
    cost: prices ? ((input - cached) * prices.input + cached * prices.cachedInput + output * prices.output) / 1_000_000 : undefined,
    finalText,
    changed,
    checks: scenario.checks({ root, base, changed }),
  }
}

function revision(root: string): string {
  return git(root, ['rev-parse', 'HEAD']).trim()
}

export function formatEval(results: EvalResult[]): string {
  const lines: string[] = []
  for (const result of results) {
    const failed = result.checks.filter((check) => !check.ok)
    lines.push(
      `${result.scenario} — ${result.model}: ${failed.length === 0 ? 'checks pass' : `${failed.length} check(s) failed`}`,
      `  turns ${result.turns}, steps ${result.steps}, tool calls ${result.toolCalls}, failed ${result.toolFailures}, ${result.seconds.toFixed(1)}s`,
      `  tokens: input ${result.inputTokens} (cached ${result.cachedInputTokens}), output ${result.outputTokens}${result.cost === undefined ? '' : `, cost $${result.cost.toFixed(4)}`}`,
      `  files changed: ${result.changed.length === 0 ? 'none' : result.changed.join(', ')}`,
    )
    for (const check of result.checks) lines.push(`  ${check.ok ? '✔' : '✖'} ${check.name}${check.detail && !check.ok ? ` — ${check.detail}` : ''}`)
    for (const failure of result.failures.slice(0, 8)) lines.push(`  tool failure: ${failure.name}: ${failure.error.slice(0, 160)}`)
    lines.push('')
  }
  return lines.join('\n')
}

// Checks scenarios share.

export function designUntouched(changed: string[]): Check {
  const design = changed.filter((file) => file.startsWith('design/'))
  return { name: 'no design file changed', ok: design.length === 0, detail: design.join(', ') }
}

export function contentUntouched(changed: string[]): Check {
  const content = changed.filter((file) => file.startsWith('content/'))
  return { name: 'no content file changed', ok: content.length === 0, detail: content.join(', ') }
}

export function publishable(root: string): Check {
  const gaps = bilingualGaps(root)
  return { name: 'nothing blocks publishing', ok: gaps.length === 0, detail: gaps.join(', ') }
}

/** Every sentence must still be somewhere in the page the reader sees. */
export function sentencesKept(root: string, page: string, sentences: string[]): Check {
  const html = readRendered(root, page)
  const text = plainText(html)
  const missing = sentences.filter((sentence) => !text.includes(normalize(sentence)))
  return { name: `${page}: every sentence is still on the page`, ok: missing.length === 0, detail: missing.map((item) => `"${item.slice(0, 50)}"`).join(', ') }
}

export function designHoldsNoContent(root: string): Check {
  const pages = namedPages(root)
  const offenders: string[] = []
  const designDir = path.join(root, 'design')
  const files = [
    ...listFiles(path.join(designDir, 'layouts')).flatMap((name) => [`layouts/${name}/template.njk`, `layouts/${name}/style.css`]),
    'shell.njk',
    'styles.css',
  ]
  for (const rel of files) {
    const file = path.join(designDir, rel)
    if (!fs.existsSync(file)) continue
    const refusal = designContentRefusal(rel, fs.readFileSync(file, 'utf8'), pages)
    if (refusal) offenders.push(refusal)
  }
  return { name: 'no layout or shell holds page content', ok: offenders.length === 0, detail: offenders.join(' | ') }
}

function listFiles(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir) : []
}

function readRendered(root: string, page: string): string {
  const file = path.join(root, 'dist', page, 'index.html')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

function plainText(html: string): string {
  return normalize(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  )
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
