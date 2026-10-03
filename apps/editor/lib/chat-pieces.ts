import { savedChange, toolPartName } from './activity'

export type ChatPiece =
  | { kind: 'text'; text: string }
  | { kind: 'reject'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'tools'; entries: { label: string; done: boolean }[] }
  | { kind: 'saves'; lines: string[] }

type Part = {
  type: string
  toolName?: string
  state?: string
  output?: unknown
  errorText?: string
  text?: string
}

export function chatPieces(parts: Part[]): ChatPiece[] {
  const pieces: ChatPiece[] = []
  let tools: { label: string; done: boolean }[] = []
  let saves: string[] = []
  const flushTools = () => {
    if (tools.length === 0) return
    pieces.push({ kind: 'tools', entries: tools })
    tools = []
  }
  const flushSaves = () => {
    if (saves.length === 0) return
    pieces.push({ kind: 'saves', lines: saves })
    saves = []
  }
  for (const part of parts) {
    if (part.type === 'text' && part.text?.trim()) {
      flushTools()
      flushSaves()
      pieces.push({ kind: 'text', text: part.text })
      continue
    }
    const name = toolPartName(part)
    if (!name) continue
    if (name === 'reject_tool') {
      flushTools()
      flushSaves()
      pieces.push({ kind: 'reject', text: part.output != null ? String(part.output) : 'That tool is in the other mode.' })
      continue
    }
    if (part.state === 'output-error' && typeof part.errorText === 'string') {
      flushTools()
      flushSaves()
      pieces.push({ kind: 'error', text: part.errorText })
      continue
    }
    const change = savedChange(part)
    if (change) {
      flushTools()
      saves.push(change)
      continue
    }
    flushSaves()
    const done = part.state === 'output-available' || part.state === 'output-error'
    tools.push({ label: toolLabel(name), done })
  }
  flushTools()
  flushSaves()
  return pieces
}

function toolLabel(name: string): string {
  const words = name.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
