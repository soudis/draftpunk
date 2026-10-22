import type { EditorMode } from './mode'
import type { ResolvedModelSettings } from './model-settings'
import type { Thinking } from './thinking'

export type Task = 'setup' | 'design' | 'content'

type Message = { role: string; parts?: { type: string; text?: string }[] }

// Words that ask for a change in how the site looks or is built.
const DESIGN = /layout|design|look\b|looks\b|gestalt|schöner|schoener|aussehen|optik|farbe|farben|colou?rs?\b|font|schrift|\bstil\b|style|css|hero|header|kopfzeile|men[üu]|footer|fu(?:ß|ss)zeile|banner|karte[n]?\b|cards?\b|abstand|spacing|größer|groesser|kleiner|bigger|smaller|breit|schmal|mobile|handy|responsive|animation|effekt|hintergrund|background|raster|grid|spalten|columns?|kontrast|contrast|logo|icon|ansprechend|modern|übersichtlich|uebersichtlich|chaotisch|aufräumen|aufraeumen|redesign|facelift|umgestalt|verschönern|verschoenern|nicer|prettier|beautiful|template|vorlage|brief|token|regel|rule|besser aus|schön|schoen|hübsch|huebsch|ordnen|anordnen|position|zentrier|center|ausrichten|align/i

// Words that ask for a change in what the site says.
const CONTENT = /ändere|aendere|ersetze|korrigier|tippfehler|schreibfehler|telefon|nummer|adresse|öffnungszeit|oeffnungszeit|datum|termin|event|veranstaltung|übersetz|uebersetz|translate|lösche|loesche|entferne|hinzufüg|hinzufueg|ergänze|ergaenze|aktualisier|schreib|text|satz|wort|titel|name|e-?mail|preis|\bfix\b|typo|change|replace|add|remove|delete|rename|correct|update|news|artikel|beitrag/i

function lastText(message: Message | undefined): string {
  return (message?.parts ?? []).filter((part) => part.type === 'text').map((part) => part.text ?? '').join(' ')
}

/**
 * Which kind of work a request is. A request is content work only when it clearly asks to change words, facts, dates,
 * or pages, and nothing in it asks for a look. Anything unclear goes to the stronger model.
 */
export function classifyRequest(messages: Message[], mode: EditorMode): Task {
  if (mode === 'setup') return 'setup'
  const user = [...messages].reverse().find((message) => message.role === 'user')
  const text = lastText(user)
  if (/https?:\/\//i.test(text) || DESIGN.test(text)) return 'design'
  if (CONTENT.test(text)) return 'content'
  return 'design'
}

export type RequestPlan = { task: Task; model: string; thinking: Thinking }

/** The model and the thinking a request gets: a cheaper model and no thinking for plain content work, when one is set. */
export function planRequest(settings: Pick<ResolvedModelSettings, 'model' | 'contentModel' | 'thinking'>, task: Task): RequestPlan {
  const model = task === 'content' && settings.contentModel ? settings.contentModel : settings.model
  const thinking: Thinking = settings.thinking === 'off' ? 'off' : settings.thinking === 'default' ? 'default' : task === 'content' ? 'off' : 'default'
  return { task, model, thinking }
}
