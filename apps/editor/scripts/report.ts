import Database from 'better-sqlite3'
import { formatReport, usageReport } from '../lib/usage-log'

// pnpm --filter @schlor/editor report -- --db path/to/chat.sqlite [--session id] [--model name] [--json]

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const file = option('db') ?? process.env.CHAT_DB
if (!file) {
  console.error('Give --db path/to/chat.sqlite, or set CHAT_DB.')
  process.exit(2)
}
const database = new Database(file, { readonly: true })
const report = usageReport(database, { sessionId: option('session'), model: option('model') })
console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report))
