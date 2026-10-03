import type { UIMessage } from 'ai'
import { modeFromMessages, type EditorMode } from './mode'

export function decodeThread(raw: string): { messages: UIMessage[]; mode: EditorMode } {
  const parsed = JSON.parse(raw) as unknown
  if (Array.isArray(parsed)) {
    const messages = parsed as UIMessage[]
    return { messages, mode: modeFromMessages(messages) ?? 'content' }
  }
  if (parsed && typeof parsed === 'object' && 'messages' in parsed) {
    const record = parsed as { messages?: UIMessage[]; mode?: string }
    const messages = Array.isArray(record.messages) ? record.messages : []
    const mode = record.mode === 'design' || record.mode === 'content' || record.mode === 'setup'
      ? record.mode
      : (modeFromMessages(messages) ?? 'content')
    return { messages, mode }
  }
  return { messages: [], mode: 'content' }
}
