type ToolCall = {
  id?: string
  index?: number
  extra_content?: { google?: { thought_signature?: string } }
  function?: { name?: string; arguments?: string }
}

type ChatBody = {
  messages?: {
    role?: string
    tool_calls?: ToolCall[]
    [key: string]: unknown
  }[]
  [key: string]: unknown
}

export function tapThoughtSignatures(response: Response, store: Map<string, string>): Response {
  if (!response.body) return response
  const decoder = new TextDecoder()
  const pending = new Map<number, { id?: string; signature?: string }>()
  let buffer = ''
  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true })
        buffer = takeLines(buffer, (line) => rememberLine(line, pending, store))
        controller.enqueue(chunk)
      },
      flush() {
        takeLines(`${buffer}\n`, (line) => rememberLine(line, pending, store))
      },
    }),
  )
  const headers = new Headers(response.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function attachThoughtSignatures<T extends ChatBody>(body: T, store: Map<string, string>): T {
  if (!body.messages) return body
  return {
    ...body,
    messages: body.messages.map((message) => {
      if (!message.tool_calls) return message
      return {
        ...message,
        tool_calls: message.tool_calls.map((call) => {
          const signature = call.id ? store.get(call.id) : undefined
          if (!signature || call.extra_content?.google?.thought_signature) return call
          return { ...call, extra_content: { google: { thought_signature: signature } } }
        }),
      }
    }),
  }
}

function takeLines(buffer: string, onLine: (line: string) => void): string {
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? ''
  for (const line of lines) onLine(line.replace(/\r$/, ''))
  return rest
}

function rememberLine(
  line: string,
  pending: Map<number, { id?: string; signature?: string }>,
  store: Map<string, string>,
) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return
  const data = trimmed.slice(5).trim()
  if (!data || data === '[DONE]') return
  let payload: { choices?: { delta?: { tool_calls?: ToolCall[] }; message?: { tool_calls?: ToolCall[] } }[] }
  try {
    payload = JSON.parse(data) as typeof payload
  } catch {
    return
  }
  for (const choice of payload.choices ?? []) {
    const calls = choice.delta?.tool_calls ?? choice.message?.tool_calls ?? []
    for (const call of calls) {
      const index = call.index ?? 0
      const current = pending.get(index) ?? {}
      if (call.id) current.id = call.id
      const signature = call.extra_content?.google?.thought_signature
      if (signature) current.signature = signature
      pending.set(index, current)
      if (current.id && current.signature) store.set(current.id, current.signature)
    }
  }
}
