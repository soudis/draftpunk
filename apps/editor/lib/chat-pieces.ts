import { savedChange, toolPartName } from './activity'
import { stripLeakedCalls } from './leaked-calls'

export type ChatPiece =
  | { kind: 'text'; text: string }
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
      // A tool call the model wrote as text (an older chat may hold one) is not shown.
      const shown = stripLeakedCalls(part.text)
      if (!shown.trim()) continue
      flushTools()
      flushSaves()
      pieces.push({ kind: 'text', text: shown })
      continue
    }
    const name = toolPartName(part)
    if (!name) continue
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

/** The tools whose result is a new picture in the media library. */
const PICTURE_MAKERS = new Set(['edit_picture', 'svg_extract', 'svg_edit', 'write_svg', 'trace_picture', 'render_graphic', 'generate_image'])

/** The pictures the agent made in this message, by file name in the media library, in the order it made them. */
export function madePictures(parts: Part[]): { file: string; generated: boolean }[] {
  const found = new Map<string, boolean>()
  for (const part of parts) {
    const name = toolPartName(part)
    if (!name || !PICTURE_MAKERS.has(name) || part.state !== 'output-available' || typeof part.output !== 'string') continue
    const file = /^Saved \/media\/([\w./-]+\.(?:png|jpe?g|webp|gif|svg))(?=[,. ]|$)/i.exec(part.output)?.[1]
    if (file) found.set(file, name === 'generate_image')
  }
  return [...found.entries()].map(([file, generated]) => ({ file, generated }))
}
