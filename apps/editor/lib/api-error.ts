export function chatErrorText(error: unknown): string {
  const presented = describeApiError(error)
  return `${presented.type}\n${presented.description}`
}

export function presentChatError(raw: string): { type: string; description: string } {
  const text = raw.replace(/\r/g, '').trim()
  if (!text) return { type: 'API error', description: 'The request failed.' }
  if (text === 'Error in input stream' || text.endsWith('\nError in input stream')) {
    return { type: 'Connection closed', description: 'The reply stopped before it finished. Send it again.' }
  }

  const json = fromJson(text)
  if (json) return json

  const dumped = fromInspect(text)
  if (dumped) return dumped

  const split = text.indexOf('\n')
  if (split > 0 && split < 120) {
    const type = text.slice(0, split).trim()
    const description = short(text.slice(split + 1))
    if (type && description && !type.startsWith('at ')) return { type, description }
  }

  return { type: 'API error', description: short(firstUsefulLine(text)) }
}

function describeApiError(error: unknown): { type: string; description: string } {
  if (!error || typeof error !== 'object') {
    return { type: 'API error', description: short(typeof error === 'string' ? error : 'The request failed.') }
  }
  const record = error as { name?: unknown; message?: unknown; statusCode?: unknown; responseBody?: unknown }
  const message = typeof record.message === 'string' ? record.message : ''
  const name = typeof record.name === 'string' && record.name !== 'Error' ? record.name : ''
  const statusCode = typeof record.statusCode === 'number' ? record.statusCode : undefined
  const responseBody = typeof record.responseBody === 'string' ? record.responseBody : undefined
  if (responseBody || statusCode) {
    const detail = responseBody ? providerDetail(responseBody) : {}
    const kind = detail.status ?? (statusCode ? `HTTP ${statusCode}` : undefined)
    return {
      type: [name || 'API error', kind].filter(Boolean).join(' · '),
      description: short(detail.message || message || 'The request failed.'),
    }
  }
  if (message) return { type: name || 'API error', description: short(message) }
  return { type: 'API error', description: 'The request failed.' }
}

function fromJson(text: string): { type: string; description: string } | null {
  if (!text.startsWith('{') && !text.startsWith('[')) return null
  const detail = providerDetail(text)
  if (detail.message) {
    return { type: detail.status ?? 'API error', description: short(detail.message) }
  }
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    if (typeof parsed.error === 'string') return { type: 'API error', description: short(parsed.error) }
  } catch {
    return null
  }
  return null
}

function fromInspect(text: string): { type: string; description: string } | null {
  if (!text.startsWith('Error [')) return null
  const named = text.match(/^Error \[([^\]]+)\]:\s*([^\n]+)/)
  const detail = providerDetail(unescapeInspect(text))
  const type = [named?.[1], detail.status].filter(Boolean).join(' · ') || 'API error'
  const description = detail.message || named?.[2]
  if (!description) return null
  return { type, description: short(description) }
}

function providerDetail(body: string): { status?: string; message?: string } {
  const parsed = parseLoose(body)
  const error = parsed && typeof parsed === 'object' && 'error' in parsed ? (parsed as { error: unknown }).error : parsed
  if (!error || typeof error !== 'object') return {}
  const fields = error as { message?: unknown; status?: unknown; type?: unknown; code?: unknown }
  const message = typeof fields.message === 'string' ? fields.message : undefined
  const status =
    typeof fields.status === 'string'
      ? fields.status
      : typeof fields.type === 'string'
        ? fields.type
        : typeof fields.code === 'string'
          ? fields.code
          : undefined
  return { status, message }
}

function parseLoose(body: string): unknown {
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as unknown
    return Array.isArray(parsed) ? parsed[0] : parsed
  } catch {
    return undefined
  }
}

function unescapeInspect(text: string): string {
  return text.replace(/\\n/g, '\n').replace(/\\"/g, '"')
}

function firstUsefulLine(text: string): string {
  const line = text
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith('at ') && !item.startsWith('<'))
  return line ?? 'The request failed.'
}

function short(message: string): string {
  const line = message.replace(/\s+/g, ' ').trim()
  const sentence = line.split(/(?<=\.)\s/)[0] ?? line
  return sentence.length > 180 ? `${sentence.slice(0, 177)}…` : sentence
}
