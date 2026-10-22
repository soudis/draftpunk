import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { formatEval, runScenario, type EvalResult } from '../lib/eval'
import { scenarios } from '../evals/scenarios'
import { modelSupportsVision } from '../lib/model-catalog'

// pnpm --filter @schlor/editor eval -- [--scenario id|all] [--network] [--json]
//   [--base-url URL] [--model NAME] [--price 0.15,0.003,0.6]   (USD per million tokens: input, cached input, output)
// The key comes from LLM_API_KEY. Base URL and model default to LLM_BASE_URL and LLM_MODEL.

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const flag = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const baseURL = option('base-url') ?? process.env.LLM_BASE_URL
  const modelName = option('model') ?? process.env.LLM_MODEL
  const apiKey = process.env.LLM_API_KEY
  if (!baseURL || !modelName || !apiKey) {
    console.error('Set LLM_API_KEY, and give --base-url and --model (or LLM_BASE_URL and LLM_MODEL).')
    process.exit(2)
  }
  const wanted = option('scenario') ?? 'all'
  const chosen = scenarios.filter((scenario) => (wanted === 'all' ? flag('network') || !scenario.network : scenario.id === wanted))
  if (chosen.length === 0) {
    console.error(`No scenario ${wanted}. Choose one of: ${scenarios.map((scenario) => scenario.id).join(', ')}, or all.`)
    process.exit(2)
  }
  const price = option('price')?.split(',').map(Number)
  const prices = price && price.length === 3 && price.every(Number.isFinite) ? { input: price[0], cachedInput: price[1], output: price[2] } : undefined
  const provider = createOpenAICompatible({ name: 'eval', baseURL, apiKey })
  const results: EvalResult[] = []
  for (const scenario of chosen) {
    console.error(`running ${scenario.id}…`)
    results.push(await runScenario(provider.chatModel(modelName), scenario, { modelName, prices, vision: modelSupportsVision(baseURL, modelName, process.env.LLM_VISION) }))
  }
  console.log(flag('json') ? JSON.stringify(results, null, 2) : formatEval(results))
  process.exit(results.some((result) => result.checks.some((check) => !check.ok)) ? 1 : 0)
}

void main()
