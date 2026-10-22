import type { LanguageModelMiddleware } from 'ai'

// DeepSeek sometimes writes a tool call as plain text in its own markup (<｜｜DSML｜｜ calls> …) instead of making
// the call. The call never runs, the step ends with "stop", and the person sees the markup.
const MARKUP = /<[｜|]+\s*DSML/
const MARKUP_START = /<[｜|]*\s*(?:D(?:S(?:M(?:L)?)?)?)?$/

export const NUDGE =
  'Your last reply wrote a tool call as plain text, so it was not run. Make the call again with the tool interface, or answer in words.'

/** The text without a leaked tool call: everything from the markup on is cut. */
export function stripLeakedCalls(text: string): string {
  const at = text.search(MARKUP)
  return at === -1 ? text : text.slice(0, at).trimEnd()
}

type Part = { type: string; [key: string]: unknown }
type Usage = { inputTokens?: number; outputTokens?: number; totalTokens?: number; reasoningTokens?: number; cachedInputTokens?: number }

const add = (a?: number, b?: number) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0))

async function* guarded(stream: ReadableStream<Part>, retry: (() => Promise<ReadableStream<Part>>) | null): AsyncGenerator<Part> {
  const reader = stream.getReader()
  const texts = new Map<string, { held: string; muted: boolean }>()
  let finish: Part | undefined
  let leaked = false
  let called = false
  for (;;) {
    const { done, value: part } = await reader.read()
    if (done) break
    if (part.type === 'finish') {
      finish = part
      continue
    }
    if (part.type === 'tool-call') called = true
    if (part.type === 'text-start') texts.set(String(part.id), { held: '', muted: false })
    if (part.type === 'text-delta') {
      const state = texts.get(String(part.id)) ?? { held: '', muted: false }
      texts.set(String(part.id), state)
      if (state.muted) continue
      const buffer = state.held + String(part.delta)
      const at = buffer.search(MARKUP)
      if (at !== -1) {
        state.muted = true
        state.held = ''
        leaked = true
        if (at > 0) yield { ...part, delta: buffer.slice(0, at) }
        continue
      }
      const held = buffer.search(MARKUP_START)
      state.held = held === -1 ? '' : buffer.slice(held)
      const out = held === -1 ? buffer : buffer.slice(0, held)
      if (out) yield { ...part, delta: out }
      continue
    }
    if (part.type === 'text-end') {
      const state = texts.get(String(part.id))
      if (state && !state.muted && state.held) yield { type: 'text-delta', id: part.id, delta: state.held }
    }
    yield part
  }
  const reason = (finish?.finishReason as string | undefined) ?? 'unknown'
  if (leaked && !called && reason === 'stop' && retry) {
    console.warn('The model wrote a tool call as text; asking it again.')
    const first = (finish?.usage ?? {}) as Usage
    for await (const part of guarded(await retry(), null)) {
      if (part.type === 'stream-start') continue
      if (part.type === 'finish') {
        const second = (part.usage ?? {}) as Usage
        yield {
          ...part,
          usage: {
            inputTokens: add(first.inputTokens, second.inputTokens),
            outputTokens: add(first.outputTokens, second.outputTokens),
            totalTokens: add(first.totalTokens, second.totalTokens),
            reasoningTokens: add(first.reasoningTokens, second.reasoningTokens),
            cachedInputTokens: add(first.cachedInputTokens, second.cachedInputTokens),
          },
        }
        continue
      }
      yield part
    }
    return
  }
  if (finish) yield finish
}

/** Hides a tool call the model wrote as text, and asks once for the real call. */
export function leakedCallMiddleware(): LanguageModelMiddleware {
  return {
    middlewareVersion: 'v2',
    wrapStream: async ({ doStream, params, model }) => {
      const first = await doStream()
      const generator = guarded(first.stream as unknown as ReadableStream<Part>, async () => {
        const again = await model.doStream({ ...params, prompt: [...params.prompt, { role: 'user', content: [{ type: 'text', text: NUDGE }] }] })
        return again.stream as unknown as ReadableStream<Part>
      })
      const stream = new ReadableStream<Part>({
        async pull(controller) {
          const next = await generator.next()
          if (next.done) controller.close()
          else controller.enqueue(next.value)
        },
        async cancel() {
          await generator.return(undefined)
        },
      })
      return { ...first, stream: stream as unknown as typeof first.stream }
    },
  }
}
