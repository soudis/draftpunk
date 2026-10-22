import path from 'node:path'
import { convertToModelMessages, streamText, type UIMessage } from 'ai'
import { commitAll } from '@/lib/git'
import { chatErrorText } from '@/lib/api-error'
import { modelFor } from '@/lib/provider'
import { classifyRequest, planRequest } from '@/lib/routing'
import { modelSupportsVision } from '@/lib/model-catalog'
import { needsReasoningPassBack, outputLimit } from '@/lib/thinking'
import { sessionFromRequest } from '@/lib/session'
import { chatDatabasePath, siteRoot } from '@/lib/site'
import { agentRun } from '@/lib/agent'
import { withoutEmptyReplies } from '@/lib/history'
import { parseMode } from '@/lib/mode'
import { nameFromFirstInput } from '@/lib/chat-name'
import { currentModelSettings } from '@/lib/model-settings'
import { chatFor, chatsFor, editorDatabase, rememberReply, storeChat } from '@/lib/sessions'
import { recordBadCall, recordStep, stepTools } from '@/lib/usage-log'

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
  const posted = (await request.json()) as { messages: UIMessage[]; mode?: string; sessionId?: string }
  // A request that failed leaves an empty reply in the chat; it is neither sent again nor stored.
  const body = { ...posted, messages: withoutEmptyReplies(posted.messages) }
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
  const plan = planRequest(modelSettings, classifyRequest(body.messages, mode))
  let step = 0
  const result = streamText({
    model: modelFor(modelSettings, plan),
    ...agentRun(mode, root, {
      vision: modelSupportsVision(modelSettings.baseURL, plan.model, process.env.LLM_VISION),
      cacheDir: path.join(path.dirname(chatDatabasePath()), 'web-cache'),
      keepReasoning: needsReasoningPassBack(modelSettings.baseURL) && plan.thinking === 'default',
      maxOutputTokens: outputLimit(modelSettings.baseURL),
      onBadCall: (call) => {
        try {
          recordBadCall(editorDatabase(), { sessionId, turn: userCount, ...call })
        } catch (error) {
          console.error('Could not record the broken call', error)
        }
      },
    }),
    messages: await convertToModelMessages(body.messages),
    abortSignal: request.signal,
    onStepFinish: (finished) => {
      try {
        recordStep(editorDatabase(), {
          sessionId,
          turn: userCount,
          step: (step += 1),
          model: plan.model,
          task: plan.task,
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
