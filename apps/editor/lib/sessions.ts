import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { UIMessage } from 'ai'
import { parseMode, type EditorMode } from './mode'
import { chatDatabasePath } from './site'
import { decodeThread } from './thread'

export type SessionSummary = {
  id: string
  title: string
  mode: EditorMode
  updatedAt: number
}

export type ChatSession = SessionSummary & {
  messages: UIMessage[]
}

let database: Database.Database | undefined

function db(): Database.Database {
  if (!database) {
    const file = chatDatabasePath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    database = new Database(file)
    migrate(database)
  }
  return database
}

export function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS thread (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      messages TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      title TEXT NOT NULL,
      messages TEXT NOT NULL,
      mode TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_owner_updated ON sessions (owner, updated_at DESC);
    CREATE TABLE IF NOT EXISTS reply_commit (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision TEXT NOT NULL,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL
    );
  `)
}

export function recordReplyCommit(database: Database.Database, sessionId: string, messageId: string, revision: string): void {
  database
    .prepare(
      `INSERT INTO reply_commit (id, revision, session_id, message_id) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, session_id = excluded.session_id, message_id = excluded.message_id`,
    )
    .run(revision, sessionId, messageId)
}

export function replyCommit(database: Database.Database): { revision: string; sessionId: string; messageId: string } | null {
  const row = database.prepare('SELECT revision, session_id, message_id FROM reply_commit WHERE id = 1').get() as
    | { revision: string; session_id: string; message_id: string }
    | undefined
  if (!row) return null
  return { revision: row.revision, sessionId: row.session_id, messageId: row.message_id }
}

export function clearReplyCommit(database: Database.Database): void {
  database.prepare('DELETE FROM reply_commit WHERE id = 1').run()
}

export function rememberReply(sessionId: string, messageId: string, revision: string): void {
  recordReplyCommit(db(), sessionId, messageId, revision)
}

export function editorDatabase(): Database.Database {
  return db()
}

export function sessionTitle(messages: { role: string; parts: { type: string; text?: string }[] }[]): string {
  for (const message of messages) {
    if (message.role !== 'user') continue
    const text = message.parts.find((part) => part.type === 'text' && part.text?.trim())?.text?.trim().replace(/\s+/g, ' ')
    if (!text) continue
    return text.length > 60 ? `${text.slice(0, 59)}…` : text
  }
  return 'New chat'
}

export function listChats(database: Database.Database, owner: string): { sessions: SessionSummary[]; current: ChatSession } {
  claimLegacy(database, owner)
  let sessions = summaries(database, owner)
  if (sessions.length === 0) {
    createChat(database, owner, 'content')
    sessions = summaries(database, owner)
  }
  const current = openChat(database, owner, sessions[0].id)
  if (!current) throw new Error('Chat session missing after create')
  return { sessions, current }
}

export function createChat(database: Database.Database, owner: string, mode: EditorMode): ChatSession {
  const session: ChatSession = {
    id: crypto.randomUUID(),
    title: 'New chat',
    messages: [],
    mode,
    updatedAt: Date.now(),
  }
  database
    .prepare('INSERT INTO sessions (id, owner, title, messages, mode, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(session.id, owner, session.title, '[]', session.mode, session.updatedAt)
  return session
}

export function openChat(database: Database.Database, owner: string, id: string): ChatSession | null {
  const row = database
    .prepare('SELECT id, title, messages, mode, updated_at FROM sessions WHERE id = ? AND owner = ?')
    .get(id, owner) as { id: string; title: string; messages: string; mode: string; updated_at: number } | undefined
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    messages: parseMessages(row.messages),
    mode: parseMode(row.mode),
    updatedAt: row.updated_at,
  }
}

export function saveChat(
  database: Database.Database,
  owner: string,
  id: string,
  messages: UIMessage[],
  mode: EditorMode,
  title?: string,
): boolean {
  const existing = openChat(database, owner, id)
  const nextTitle = title?.trim()
    ? title.trim()
    : existing && existing.title !== 'New chat'
      ? existing.title
      : sessionTitle(messages)
  const result = database
    .prepare('UPDATE sessions SET title = ?, messages = ?, mode = ?, updated_at = ? WHERE id = ? AND owner = ?')
    .run(nextTitle, JSON.stringify(messages), mode, Date.now(), id, owner)
  return result.changes === 1
}

export function setChatMode(database: Database.Database, owner: string, id: string, mode: EditorMode): boolean {
  const result = database.prepare('UPDATE sessions SET mode = ? WHERE id = ? AND owner = ?').run(mode, id, owner)
  return result.changes === 1
}

export function deleteChat(database: Database.Database, owner: string, id: string): { sessions: SessionSummary[]; current: ChatSession } | null {
  const existing = openChat(database, owner, id)
  if (!existing) return null
  database.prepare('DELETE FROM sessions WHERE id = ? AND owner = ?').run(id, owner)
  return listChats(database, owner)
}

export function chatsFor(owner: string) {
  return listChats(db(), owner)
}

export function startChat(owner: string, mode: EditorMode) {
  return createChat(db(), owner, mode)
}

export function chatFor(owner: string, id: string) {
  return openChat(db(), owner, id)
}

export function storeChat(owner: string, id: string, messages: UIMessage[], mode: EditorMode, title?: string) {
  return saveChat(db(), owner, id, messages, mode, title)
}

export function storeChatMode(owner: string, id: string, mode: EditorMode) {
  return setChatMode(db(), owner, id, mode)
}

export function removeChat(owner: string, id: string) {
  return deleteChat(db(), owner, id)
}

function summaries(database: Database.Database, owner: string): SessionSummary[] {
  const rows = database
    .prepare('SELECT id, title, mode, updated_at FROM sessions WHERE owner = ? ORDER BY updated_at DESC')
    .all(owner) as { id: string; title: string; mode: string; updated_at: number }[]
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    mode: parseMode(row.mode),
    updatedAt: row.updated_at,
  }))
}

function claimLegacy(database: Database.Database, owner: string): void {
  const claim = database.transaction(() => {
    const row = database.prepare('SELECT messages FROM thread WHERE id = 1').get() as { messages: string } | undefined
    if (!row) return
    const decoded = decodeThread(row.messages)
    database.prepare('DELETE FROM thread WHERE id = 1').run()
    if (decoded.messages.length === 0) return
    const session: ChatSession = {
      id: crypto.randomUUID(),
      title: sessionTitle(decoded.messages),
      messages: decoded.messages,
      mode: decoded.mode,
      updatedAt: Date.now(),
    }
    database
      .prepare('INSERT INTO sessions (id, owner, title, messages, mode, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(session.id, owner, session.title, JSON.stringify(session.messages), session.mode, session.updatedAt)
  })
  claim()
}

function parseMessages(raw: string): UIMessage[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as UIMessage[]) : []
  } catch {
    return []
  }
}
