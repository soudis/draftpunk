import { convertToModelMessages, streamText, type UIMessage } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { commitAll } from '@/lib/git'
import { chatErrorText } from '@/lib/api-error'
import { attachThoughtSignatures, tapThoughtSignatures } from '@/lib/gemini'
import { sessionFromRequest } from '@/lib/session'
import { siteRoot } from '@/lib/site'
import { agentRun } from '@/lib/agent'
import { parseMode } from '@/lib/mode'
import { nameFromFirstInput } from '@/lib/chat-name'
import { currentModelSettings } from '@/lib/model-settings'
import { chatFor, chatsFor, editorDatabase, rememberReply, storeChat } from '@/lib/sessions'
import { recordStep, stepTools } from '@/lib/usage-log'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  return Response.json(chatsFor(session.sub).current)
}

export async function POST(request: Request) {
  const session = await sessionFromRequest(request)
  if (!session) return Response.json({ error: 'Login required' }, { status: 401 })
  const modelSettings = currentModelSettings()
  if (!modelSettings.apiKey) {
    return new Response('LLM_API_KEY is not set', { status: 400 })
  }
  const body = (await request.json()) as { messages: UIMessage[]; mode?: string; sessionId?: string }
  const mode = parseMode(body.mode)
  if (!body.sessionId || !chatFor(session.sub, body.sessionId)) {
    return Response.json({ error: 'Chat not found' }, { status: 404 })
  }
  const sessionId = body.sessionId
  const chat = chatFor(session.sub, sessionId)
  const firstUser = body.messages.find((message) => message.role === 'user')
  const firstText = firstUser?.parts.find((part) => part.type === 'text' && 'text' in part && part.text?.trim())
  const userCount = body.messages.filter((message) => message.role === 'user').length
  const naming =
    chat?.title === 'New chat' && userCount === 1 && firstText && 'text' in firstText
      ? nameFromFirstInput(firstText.text)
      : undefined
  const root = siteRoot()
  const thoughtSignatures = new Map<string, string>()
  const provider = createOpenAICompatible({
    name: 'editor',
    baseURL: modelSettings.baseURL,
    apiKey: modelSettings.apiKey,
    fetch: async (input, init) => tapThoughtSignatures(await fetch(input, init), thoughtSignatures),
    transformRequestBody: (body) => attachThoughtSignatures(body, thoughtSignatures),
  })
  let step = 0
  const result = streamText({
    model: provider.chatModel(modelSettings.model),
    ...agentRun(mode, root),
    messages: await convertToModelMessages(body.messages),
    abortSignal: request.signal,
    onStepFinish: (finished) => {
      try {
        recordStep(editorDatabase(), {
          sessionId,
          turn: userCount,
          step: (step += 1),
          model: modelSettings.model,
          inputTokens: finished.usage.inputTokens ?? 0,
          cachedInputTokens: finished.usage.cachedInputTokens ?? 0,
          outputTokens: finished.usage.outputTokens ?? 0,
          finishReason: finished.finishReason,
          tools: stepTools(finished.content),
        })
      } catch (error) {
        console.error('Could not record the step', error)
      }
    },
  })
  return result.toUIMessageStreamResponse({
    originalMessages: body.messages,
    // nginx-proxy drops the response after 60s without a byte. A model step can stay quiet longer than that.
    keepAliveMs: 15_000,
    onError: (error) => {
      console.error(error)
      return chatErrorText(error)
    },
    onFinish: async ({ messages }) => {
      const latestUser = [...body.messages].reverse().find((message) => message.role === 'user')
      const text = latestUser?.parts.find((part) => part.type === 'text')
      const revision = commitAll(root, text && 'text' in text ? text.text : 'Editor change', {
        name: session.name,
        email: session.email,
      })
      const assistant = [...messages].reverse().find((message) => message.role === 'assistant')
      if (revision && assistant?.id) rememberReply(sessionId, assistant.id, revision)
      storeChat(session.sub, sessionId, messages, mode, naming ? await naming : undefined)
    },
  })
}
