const SITE_WRITES = new Set([
  'write_design',
  'replace_layout',
  'write_page',
  'write_event',
  'write_place',
  'delete_page',
  'delete_event',
  'delete_place',
  'set_homepage_news',
  'save_picture',
  'fit_picture',
  'discard_picture',
  'accept_setup',
])

export function toolPartName(part: { type: string; toolName?: string }): string | undefined {
  if (part.type === 'dynamic-tool' && part.toolName) return part.toolName
  return part.type.startsWith('tool-') ? part.type.slice(5) : undefined
}

export function savedChange(part: { type: string; toolName?: string; state?: string; output?: unknown }): string | null {
  const name = toolPartName(part)
  if (!name || !SITE_WRITES.has(name) || part.state !== 'output-available') return null
  if (typeof part.output === 'string' && part.output.trim()) return part.output.trim()
  return `Updated ${name.replaceAll('_', ' ')}.`
}

export function unchangedNote(
  parts: { type: string; toolName?: string; state?: string; output?: unknown; text?: string }[],
  status: string,
): string | null {
  if (status === 'submitted' || status === 'streaming') return null
  if (parts.some((part) => savedChange(part))) return null
  const spoke = parts.some((part) => part.type === 'text' && part.text?.trim())
  const usedTool = parts.some((part) => {
    const name = toolPartName(part)
    return name && name !== 'reject_tool'
  })
  return usedTool && !spoke ? 'Nothing was saved.' : null
}

export function activityLabel(
  messages: { role: string; parts: { type: string; state?: string }[] }[],
  status: string,
): string | null {
  if (status !== 'submitted' && status !== 'streaming') return null
  const assistant = [...messages].reverse().find((message) => message.role === 'assistant')
  const tool = assistant?.parts.find(
    (part) =>
      part.type.startsWith('tool-') &&
      part.type !== 'tool-reject_tool' &&
      part.state !== 'output-available' &&
      part.state !== 'output-error',
  )
  if (tool) return `Using ${tool.type.replace(/^tool-/, '').replaceAll('_', ' ')}…`
  return status === 'submitted' ? 'Thinking…' : 'Writing…'
}
