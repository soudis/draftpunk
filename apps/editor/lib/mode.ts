export type EditorMode = 'content' | 'design' | 'setup'

const DESIGN_TOOLS = new Set(['list_design', 'read_design', 'write_design', 'replace_layout', 'read_website'])
const CONTENT_TOOLS = new Set([
  'search_content',
  'list_pages',
  'read_page',
  'write_page',
  'list_events',
  'read_event',
  'write_event',
  'delete_event',
  'list_places',
  'read_place',
  'write_place',
  'delete_place',
  'delete_page',
  'set_homepage_news',
  'list_pictures',
  'read_picture',
  'save_picture',
  'fit_picture',
  'discard_picture',
])
const SETUP_TOOLS = new Set(['read_site', 'propose_setup', 'accept_setup'])

const CONTENT_WRITES = new Set([
  'write_page',
  'delete_page',
  'write_event',
  'delete_event',
  'write_place',
  'delete_place',
  'set_homepage_news',
  'save_picture',
  'fit_picture',
  'discard_picture',
])

export function parseMode(value: string | null | undefined): EditorMode {
  if (value === 'design' || value === 'setup') return value
  return 'content'
}

export function modeFromMessages(messages: { parts?: { type: string; toolName?: string }[] }[]): EditorMode | null {
  let sawContentRead = false
  for (const message of [...messages].reverse()) {
    for (const part of [...(message.parts ?? [])].reverse()) {
      const name = part.type === 'dynamic-tool' ? part.toolName : part.type.startsWith('tool-') ? part.type.slice(5) : undefined
      if (!name || name === 'reject_tool') continue
      if (SETUP_TOOLS.has(name)) return 'setup'
      if (DESIGN_TOOLS.has(name)) return 'design'
      if (CONTENT_WRITES.has(name)) return 'content'
      if (CONTENT_TOOLS.has(name)) sawContentRead = true
    }
  }
  return sawContentRead ? 'content' : null
}

export function initialMode(stored: string | null, fromServer: string | undefined): EditorMode {
  if (stored === 'design' || stored === 'content' || stored === 'setup') return stored
  return fromServer === 'design' || fromServer === 'setup' ? fromServer : 'content'
}

export function unavailableToolMessage(mode: EditorMode, toolName: string): string {
  const home = SETUP_TOOLS.has(toolName) ? 'Setup' : DESIGN_TOOLS.has(toolName) || mode === 'content' ? 'Design' : 'Content'
  return `${toolName} is only available in ${home} mode. Switch to ${home} and send the request again.`
}
