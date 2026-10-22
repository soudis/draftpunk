import type Database from 'better-sqlite3'

export type StepRecord = {
  sessionId: string
  turn: number
  step: number
  model: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  finishReason: string
  tools: { name: string; error?: string }[]
}

export function migrateUsage(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS step_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      turn INTEGER NOT NULL,
      step INTEGER NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      cached_input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      finish_reason TEXT NOT NULL,
      tools TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS step_log_session ON step_log (session_id, turn, step);
  `)
}

export function recordStep(database: Database.Database, record: StepRecord, at = Date.now()): void {
  database
    .prepare(
      `INSERT INTO step_log (at, session_id, turn, step, model, input_tokens, cached_input_tokens, output_tokens, finish_reason, tools)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      at,
      record.sessionId,
      record.turn,
      record.step,
      record.model,
      record.inputTokens,
      record.cachedInputTokens,
      record.outputTokens,
      record.finishReason,
      JSON.stringify(record.tools),
    )
}

/** What a step produced, in the shape the log keeps: tool names and the full text of each failure. */
export function stepTools(content: readonly { type: string; toolName?: string; error?: unknown }[]): StepRecord['tools'] {
  const tools: StepRecord['tools'] = []
  for (const part of content) {
    if (part.type === 'tool-result' && part.toolName) tools.push({ name: part.toolName })
    if (part.type === 'tool-error' && part.toolName) {
      const error = part.error instanceof Error ? part.error.message : String(part.error)
      tools.push({ name: part.toolName, error: error.slice(0, 2000) })
    }
  }
  return tools
}

type Row = {
  session_id: string
  turn: number
  model: string
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  tools: string
}

export type UsageReport = {
  turns: number
  steps: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  cacheHitRate: number
  toolCalls: number
  toolFailures: number
  failureRate: number
  byTool: { name: string; calls: number; failures: number }[]
  largestTurnInputTokens: number
  failures: { name: string; error: string; count: number }[]
}

export function usageReport(database: Database.Database, filter: { sessionId?: string; model?: string } = {}): UsageReport {
  const clauses: string[] = []
  const values: string[] = []
  if (filter.sessionId) {
    clauses.push('session_id = ?')
    values.push(filter.sessionId)
  }
  if (filter.model) {
    clauses.push('model = ?')
    values.push(filter.model)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = database
    .prepare(`SELECT session_id, turn, model, input_tokens, cached_input_tokens, output_tokens, tools FROM step_log ${where} ORDER BY id`)
    .all(...values) as Row[]
  const turnInput = new Map<string, number>()
  const byTool = new Map<string, { calls: number; failures: number }>()
  const failures = new Map<string, { name: string; error: string; count: number }>()
  let input = 0
  let cached = 0
  let output = 0
  for (const row of rows) {
    input += row.input_tokens
    cached += row.cached_input_tokens
    output += row.output_tokens
    const key = `${row.session_id}:${row.turn}`
    turnInput.set(key, (turnInput.get(key) ?? 0) + row.input_tokens)
    for (const tool of JSON.parse(row.tools) as StepRecord['tools']) {
      const entry = byTool.get(tool.name) ?? { calls: 0, failures: 0 }
      entry.calls += 1
      if (tool.error) {
        entry.failures += 1
        const short = tool.error.slice(0, 160)
        const known = failures.get(`${tool.name}:${short}`) ?? { name: tool.name, error: short, count: 0 }
        known.count += 1
        failures.set(`${tool.name}:${short}`, known)
      }
      byTool.set(tool.name, entry)
    }
  }
  const calls = [...byTool.values()].reduce((total, item) => total + item.calls, 0)
  const failed = [...byTool.values()].reduce((total, item) => total + item.failures, 0)
  return {
    turns: turnInput.size,
    steps: rows.length,
    inputTokens: input,
    cachedInputTokens: cached,
    outputTokens: output,
    cacheHitRate: input ? cached / input : 0,
    toolCalls: calls,
    toolFailures: failed,
    failureRate: calls ? failed / calls : 0,
    byTool: [...byTool.entries()].map(([name, item]) => ({ name, ...item })).sort((a, b) => b.calls - a.calls),
    largestTurnInputTokens: Math.max(0, ...turnInput.values()),
    failures: [...failures.values()].sort((a, b) => b.count - a.count),
  }
}

export function formatReport(report: UsageReport): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`
  const lines = [
    `turns ${report.turns}, steps ${report.steps}`,
    `input tokens ${report.inputTokens} (cached ${report.cachedInputTokens}, ${pct(report.cacheHitRate)}), output tokens ${report.outputTokens}`,
    `largest turn: ${report.largestTurnInputTokens} input tokens`,
    `tool calls ${report.toolCalls}, failed ${report.toolFailures} (${pct(report.failureRate)})`,
    '',
    'tool                 calls  failed',
    ...report.byTool.map((tool) => `${tool.name.padEnd(20)} ${String(tool.calls).padStart(5)}  ${String(tool.failures).padStart(6)}`),
  ]
  if (report.failures.length > 0) {
    lines.push('', 'failures')
    for (const failure of report.failures.slice(0, 10)) lines.push(`${String(failure.count).padStart(4)}× ${failure.name}: ${failure.error}`)
  }
  return lines.join('\n')
}
