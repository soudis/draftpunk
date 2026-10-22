import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateText, type LanguageModel, type ModelMessage } from 'ai'
import { applyProposal, bilingualGaps, readSiteConfig, generate, initSite, labelNames, labelReferences, listLayoutNames, lostContent, readLayout, readProposal, readTokens } from '@schlor/generator'
import { agentRun } from './agent'
import { commitAll, ensureGit, filesChangedSince, git } from './git'
import { designContentRefusal, namedPages } from './layout-guard'
import type { EditorMode } from './mode'
import { classifyRequest, planRequest, type RequestPlan, type Task } from './routing'
import { needsReasoningPassBack, outputLimit, thinkingParams } from './thinking'
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
  /** The kind of work each turn was taken for, and the model it got. */
  turnPlans: { task: Task; model: string }[]
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

export type Routing = {
  settings: { baseURL: string; model: string; contentModel: string; thinking: 'auto' | 'off' | 'default' }
  modelFor: (plan: RequestPlan) => LanguageModel
}

export async function runScenario(
  model: LanguageModel,
  scenario: Scenario,
  options: { modelName: string; root?: string; prices?: Prices; vision?: boolean; routing?: Routing } = { modelName: 'model' },
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
  const turnPlans: EvalResult['turnPlans'] = []
  const asked: { role: string; parts: { type: string; text: string }[] }[] = []
  for (const turn of scenario.turns) {
    messages.push({ role: 'user', content: turn })
    asked.push({ role: 'user', parts: [{ type: 'text', text: turn }] })
    const plan = options.routing ? planRequest(options.routing.settings, classifyRequest(asked, scenario.mode ?? 'edit')) : undefined
    turnPlans.push({ task: plan?.task ?? 'design', model: plan?.model ?? options.modelName })
    const result = await generateText({
      model: plan && options.routing ? options.routing.modelFor(plan) : model,
      ...agentRun(scenario.mode ?? 'edit', root, {
        vision: options.vision,
        maxOutputTokens: options.routing ? outputLimit(options.routing.settings.baseURL) : undefined,
        quietModel:
          plan && options.routing && plan.thinking === 'default' && Object.keys(thinkingParams(options.routing.settings.baseURL, plan.model, 'off')).length > 0
            ? options.routing.modelFor({ ...plan, thinking: 'off' })
            : undefined,
        keepReasoning: Boolean(plan && options.routing && needsReasoningPassBack(options.routing.settings.baseURL) && plan.thinking === 'default'),
      }),
      messages,
    })
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
    turnPlans,
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
      `  turns: ${result.turnPlans.map((plan) => `${plan.task} on ${plan.model}`).join('; ')}`,
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

/**
 * A setup proposal that is only recorded changes nothing on the site, so it cannot be checked by what changed.
 * Accept it on a copy, and look at what comes out: it applies, every page fits its layout, no words are lost, no
 * layout holds content, every label a template uses exists, and the design follows its own tokens.
 */
export function proposalAccepts(root: string): Check[] {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'schlor-accept-'))
  fs.cpSync(root, copy, { recursive: true })
  const proposal = readProposal(copy)
  if (Object.keys(proposal).length === 0) return [{ name: 'a proposal was recorded', ok: false, detail: 'nothing was recorded' }]
  const checks: Check[] = [{ name: 'a proposal was recorded', ok: true }]
  try {
    const notes = applyProposal(copy, proposal, true)
    generate(copy)
    checks.push({ name: 'the proposal can be accepted', ok: true })
    const warned = notes.indexOf('WARNING')
    checks.push({ name: 'no warning from accepting it', ok: warned === -1, detail: warned === -1 ? '' : notes.slice(warned) })
  } catch (error) {
    checks.push({ name: 'the proposal can be accepted', ok: false, detail: error instanceof Error ? error.message : String(error) })
    return checks
  }
  checks.push(publishable(copy))
  const lost = lostContent(copy)
  checks.push({ name: 'every slot word is on its page', ok: lost.length === 0, detail: lost.join('; ') })
  checks.push(designHoldsNoContent(copy))
  const design = path.join(copy, 'design')
  const defined = new Set(labelNames(copy))
  const missing: string[] = []
  for (const name of listLayoutNames(design)) {
    const file = path.join(design, 'layouts', name, 'template.njk')
    for (const label of labelReferences(fs.readFileSync(file, 'utf8'))) if (!defined.has(label)) missing.push(`${name}: ${label}`)
    if (!readLayout(design, name).purpose) missing.push(`${name}: no purpose`)
  }
  checks.push({ name: 'every label and purpose a layout needs exists', ok: missing.length === 0, detail: missing.join(', ') })
  const labels = [...defined]
  checks.push({ name: 'labels are named, not numbered', ok: labels.every((name) => /^[a-z][a-z0-9_]*$/.test(name)), detail: labels.slice(0, 5).join(', ') })
  const siteName = readSiteConfig(copy).name
  checks.push({ name: 'the site has its own name', ok: siteName !== 'Housing project', detail: siteName })
  const colors = Object.keys(readTokens(copy).colors)
  checks.push({ name: 'the colors are tokens', ok: colors.includes('primary') && colors.includes('on-primary'), detail: colors.join(', ') })
  return checks
}
