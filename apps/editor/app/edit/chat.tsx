'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { activityLabel, savedChange, unchangedNote } from '@/lib/activity'
import { phraseChange } from '@/lib/correct-phrase'
import { presentChatError } from '@/lib/api-error'
import type { Block, Inline } from '@/lib/chat-markdown'
import { parseChatMarkdown } from '@/lib/chat-markdown'
import { chatPieces } from '@/lib/chat-pieces'
import {
  addressSuggestions,
  modelAfterProviderPick,
  modelSuggestions,
  providerForBase,
  type ModelChoice,
} from '@/lib/model-catalog'
import type { EditorMode } from '@/lib/mode'
import { PictureDesk } from './pictures'

type SessionSummary = {
  id: string
  title: string
  mode: EditorMode
  updatedAt: number
}

type ChatRecord = SessionSummary & {
  messages: UIMessage[]
}

type UndoTarget = { messageId: string }

function elementFrom(target: EventTarget | null): Element | null {
  if (!target || typeof target !== 'object') return null
  const node = target as Node
  if (node.nodeType === 3) return node.parentElement
  if (node.nodeType === 1) return node as Element
  return null
}

export function ChatPanel({
  siteName,
  accountName,
  accountPicture,
  gapCount,
  gapSample,
  publishEnabled,
  setupOpen,
  tokenSet,
}: {
  siteName: string
  accountName: string
  accountPicture?: string
  gapCount: number
  gapSample: string[]
  publishEnabled: boolean
  setupOpen: boolean
  tokenSet: boolean
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [current, setCurrent] = useState<ChatRecord | null>(null)
  const [streamBusy, setStreamBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishChanges, setPublishChanges] = useState<string[]>([])
  const [publishBusy, setPublishBusy] = useState(false)
  const [revertOpen, setRevertOpen] = useState(false)
  const [undo, setUndo] = useState<UndoTarget | null>(null)
  const [undoing, setUndoing] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLIFrameElement>(null)
  const [previewSrc, setPreviewSrc] = useState('/')
  const [shownName, setShownName] = useState(siteName)
  const [modelReady, setModelReady] = useState(tokenSet)
  const [settingsOpen, setSettingsOpen] = useState(!tokenSet)
  const [correcting, setCorrecting] = useState(false)
  const [correctError, setCorrectError] = useState('')
  const correctingRef = useRef(false)
  const reloadPreviewRef = useRef<() => void>(() => {})
  const syncCorrectionRef = useRef<() => void>(() => {})
  correctingRef.current = correcting

  useEffect(() => {
    const stored = Number(localStorage.getItem('schlor-chat-width'))
    if (stored >= 320) setChatWidth(stored)
  }, [])

  useEffect(() => {
    void fetch('/api/sessions')
      .then((response) => response.json())
      .then((data: { sessions?: SessionSummary[]; current?: ChatRecord }) => {
        if (!data.sessions || !data.current) return
        setSessions(data.sessions)
        setCurrent(data.current)
      })
    refreshUndo()
  }, [])

  function refreshUndo() {
    void fetch('/api/draft')
      .then((response) => response.json())
      .then((data: { undo?: UndoTarget | null }) => {
        setUndo(data.undo?.messageId ? { messageId: data.undo.messageId } : null)
      })
  }

  function remember(next: ChatRecord) {
    setCurrent(next)
    setSessions((list) => [next, ...list.filter((session) => session.id !== next.id)])
    setConfirmDelete(false)
  }

  async function openSession(id: string) {
    if (streamBusy || id === current?.id) return
    const response = await fetch(`/api/sessions/${id}`)
    if (!response.ok) return
    remember((await response.json()) as ChatRecord)
  }

  async function createSession() {
    if (streamBusy) return
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: current?.mode ?? 'content' }),
    })
    if (!response.ok) return
    remember((await response.json()) as ChatRecord)
  }

  async function deleteSession() {
    if (!current || streamBusy) return
    const response = await fetch(`/api/sessions/${current.id}`, { method: 'DELETE' })
    if (!response.ok) return
    const data = (await response.json()) as { sessions: SessionSummary[]; current: ChatRecord }
    setSessions(data.sessions)
    setCurrent(data.current)
    setConfirmDelete(false)
  }

  function selectMode(mode: EditorMode) {
    if (!current || streamBusy) return
    setCurrent({ ...current, mode })
    setSessions((list) => list.map((session) => (session.id === current.id ? { ...session, mode } : session)))
    void fetch(`/api/sessions/${current.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
    })
  }

  function reloadPreview() {
    let path = previewSrc
    try {
      const loc = previewRef.current?.contentWindow?.location
      if (loc?.pathname) path = `${loc.pathname}${loc.search}${loc.hash}`
    } catch {
      path = previewSrc
    }
    const url = new URL(path, window.location.origin)
    url.searchParams.set('v', String(Date.now()))
    setPreviewSrc(`${url.pathname}${url.search}${url.hash}`)
  }
  reloadPreviewRef.current = reloadPreview

  function syncCorrection() {
    const doc = previewRef.current?.contentDocument
    if (!doc?.documentElement || !doc.head) return
    const on = correctingRef.current
    doc.documentElement.dataset.correcting = on ? '1' : '0'
    const styleId = 'draft-correct-style'
    const existing = doc.getElementById(styleId)
    if (on && !existing) {
      const style = doc.createElement('style')
      style.id = styleId
      style.textContent = '[contenteditable="plaintext-only"]{cursor:text}[contenteditable="plaintext-only"]:hover{outline:1px dashed #1c1c1f;outline-offset:2px}[contenteditable="plaintext-only"]:focus{outline:2px solid #1c1c1f;outline-offset:2px}'
      doc.head.appendChild(style)
    } else if (!on && existing) {
      existing.remove()
    }
    doc.querySelectorAll('[data-content]').forEach((node) => {
      if (on) node.setAttribute('contenteditable', 'plaintext-only')
      else node.removeAttribute('contenteditable')
    })
    if (doc.documentElement.dataset.correctBound === '1') return
    doc.documentElement.dataset.correctBound = '1'
    doc.addEventListener('click', (event) => {
      if (doc.documentElement.dataset.correcting !== '1') return
      const anchor = elementFrom(event.target)?.closest('a')
      if (anchor) event.preventDefault()
    }, true)
    doc.addEventListener('focusin', (event) => {
      const host = elementFrom(event.target)?.closest('[data-content]')
      if (!host) return
      host.setAttribute('data-before', host.textContent ?? '')
    })
    doc.addEventListener('focusout', (event) => {
      if (doc.documentElement.dataset.correcting !== '1') return
      const host = elementFrom(event.target)?.closest('[data-content]')
      if (!host) return
      const before = host.getAttribute('data-before') ?? ''
      const after = host.textContent ?? ''
      if (before === after) return
      host.setAttribute('data-before', after)
      const hint = host.getAttribute('data-content') ?? ''
      const change = phraseChange(before, after)
      if (!change) {
        setCorrectError('That text is not in the content.')
        reloadPreviewRef.current()
        return
      }
      void fetch('/api/correct', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hint, old: change.old, next: change.next }),
      })
        .then(async (response) => {
          const data = (await response.json().catch(() => ({}))) as { error?: string }
          if (!response.ok) {
            setCorrectError(data.error || 'That text could not be corrected.')
            reloadPreviewRef.current()
            return
          }
          setCorrectError('')
          reloadPreviewRef.current()
        })
        .catch(() => {
          setCorrectError('That text could not be corrected.')
          reloadPreviewRef.current()
        })
    })
  }
  syncCorrectionRef.current = syncCorrection

  useEffect(() => {
    syncCorrectionRef.current()
  }, [correcting, previewSrc])

  function setChatWidth(width: number) {
    const shell = shellRef.current
    if (!shell) return 420
    const max = Math.max(320, Math.min(window.innerWidth - 280, Math.round(window.innerWidth * 0.72)))
    const next = Math.round(Math.min(max, Math.max(320, width)))
    shell.style.setProperty('--chat-width', `${next}px`)
    shell.querySelector('.splitter')?.setAttribute('aria-valuenow', String(next))
    return next
  }

  function startChatResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    const startX = event.clientX
    const startWidth = shellRef.current?.querySelector('.chat')?.getBoundingClientRect().width ?? 420
    handle.setPointerCapture(event.pointerId)
    document.body.classList.add('resizing')
    const move = (ev: globalThis.PointerEvent) => {
      setChatWidth(startWidth + ev.clientX - startX)
    }
    const stop = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
      document.body.classList.remove('resizing')
      const width = shellRef.current?.querySelector('.chat')?.getBoundingClientRect().width
      if (width) localStorage.setItem('schlor-chat-width', String(Math.round(width)))
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  function nudgeChatWidth(event: KeyboardEvent<HTMLDivElement>) {
    const current = shellRef.current?.querySelector('.chat')?.getBoundingClientRect().width ?? 420
    const step = event.key === 'ArrowRight' ? 24 : event.key === 'ArrowLeft' ? -24 : 0
    if (!step) return
    event.preventDefault()
    localStorage.setItem('schlor-chat-width', String(setChatWidth(current + step)))
  }

  async function openPublish() {
    setNotice(null)
    setPublishBusy(true)
    try {
      const response = await fetch('/api/publish')
      const data = (await response.json()) as { error?: string; changes?: string[] }
      if (!response.ok || data.error) {
        setNotice({ text: data.error ?? 'Could not list changes', bad: true })
        return
      }
      setPublishChanges(data.changes ?? [])
      setPublishOpen(true)
    } finally {
      setPublishBusy(false)
    }
  }

  async function confirmPublish() {
    if (publishChanges.length === 0) {
      setPublishOpen(false)
      return
    }
    setPublishBusy(true)
    try {
      const response = await fetch('/api/publish', { method: 'POST' })
      const data = (await response.json()) as { error?: string }
      if (!response.ok || data.error) {
        setNotice({ text: data.error ?? 'Publish failed', bad: true })
        return
      }
      setNotice({ text: 'Published.', bad: false })
      setPublishOpen(false)
      reloadPreview()
    } finally {
      setPublishBusy(false)
    }
  }

  async function confirmRevert() {
    setNotice(null)
    const response = await fetch('/api/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'revert' }),
    })
    const data = (await response.json()) as { error?: string }
    if (!response.ok || data.error) {
      setNotice({ text: data.error ?? 'The draft could not be reverted', bad: true })
      return
    }
    setRevertOpen(false)
    setUndo(null)
    setNotice({ text: 'Reverted the draft.', bad: false })
    reloadPreview()
  }

  async function undoReply() {
    setNotice(null)
    setUndoing(true)
    try {
      const response = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'undo' }),
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok || data.error) {
        setNotice({ text: data.error ?? 'That reply could not be undone.', bad: true })
        return
      }
      setUndo(null)
      reloadPreview()
    } finally {
      setUndoing(false)
    }
  }

  return (
    <>
    <div className="shell" ref={shellRef}>
      <section className="chat">
        <header className="bar">
          <h1>{shownName}</h1>
          <div className="bar-actions">
            <button className="publish" type="button" disabled={publishBusy} onClick={() => void openPublish()}>
              Publish
            </button>
            <button type="button" onClick={() => setRevertOpen(true)}>
              Revert draft
            </button>
            <button type="button" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
            <AccountMenu name={accountName} picture={accountPicture} />
          </div>
        </header>
        {notice && <p className={notice.bad ? 'error' : 'notice'}>{notice.text}</p>}
        {current && (
          <ChatConversation
            key={current.id}
            sessionId={current.id}
            initialMessages={current.messages}
            mode={current.mode ?? 'content'}
            onBusy={setStreamBusy}
            onFinished={() => {
              refreshUndo()
              void fetch('/api/sessions')
                .then((response) => response.json())
                .then((data: { sessions?: SessionSummary[] }) => {
                  if (data.sessions) setSessions(data.sessions)
                })
            }}
            onSaved={reloadPreview}
            modelReady={modelReady}
            onNeedToken={() => {
              setNotice({ text: 'Save a token in Settings before sending.', bad: true })
              setSettingsOpen(true)
            }}
            undoMessageId={undo?.messageId ?? null}
            undoing={undoing}
            onUndo={() => void undoReply()}
            controls={
              <div className="composer-line">
                {(setupOpen || current.mode === 'setup') && (
                  <div className="modes">
                    <button type="button" aria-pressed={current.mode === 'setup'} disabled={streamBusy} onClick={() => selectMode('setup')}>
                      Setup
                    </button>
                  </div>
                )}
                <div className="sessions">
                  <select
                    aria-label="Chat"
                    value={current.id}
                    disabled={streamBusy}
                    onChange={(event) => void openSession(event.target.value)}
                  >
                    {sessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {session.title}
                      </option>
                    ))}
                  </select>
                  {confirmDelete ? (
                    <>
                      <button key="confirm" type="button" className="quiet" onClick={() => void deleteSession()}>
                        Delete chat
                      </button>
                      <button key="keep" type="button" onClick={() => setConfirmDelete(false)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <button key="new" type="button" disabled={streamBusy} onClick={() => void createSession()}>
                        New
                      </button>
                      <button key="delete" type="button" className="quiet" disabled={streamBusy} onClick={() => setConfirmDelete(true)}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            }
          />
        )}
      </section>
      <div
        className="splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Chat width"
        aria-valuemin={320}
        aria-valuenow={420}
        tabIndex={0}
        onPointerDown={startChatResize}
        onKeyDown={nudgeChatWidth}
      />
      <section className="preview">
        <iframe title="Draft preview" ref={previewRef} src={previewSrc} onLoad={() => syncCorrectionRef.current()} />
        <button
          type="button"
          className="correct-toggle"
          aria-pressed={correcting}
          onClick={() => {
            setCorrectError('')
            setCorrecting((value) => !value)
          }}
        >
          Correct text
        </button>
        {correctError ? <p className="correct-note">{correctError}</p> : null}
      </section>
    </div>
      {publishOpen && (
        <div className="modal-back" onClick={() => setPublishOpen(false)}>
          <div className="modal confirm" role="dialog" aria-modal="true" aria-label="Publish" onClick={(event) => event.stopPropagation()}>
            <h2>Publish</h2>
            {gapCount > 0 && (
              <p className="gaps">
                {gapCount} required texts are still empty. {gapSample.join(', ')}
              </p>
            )}
            {!publishEnabled && <p className="gaps">Publish stays off until the public host is switched on.</p>}
            {publishChanges.length === 0 ? (
              <p>Nothing would be published.</p>
            ) : (
              <ul className="publish-list">
                {publishChanges.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ul>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setPublishOpen(false)}>Cancel</button>
              {publishChanges.length > 0 && (
                <button className="primary" type="button" disabled={publishBusy || !publishEnabled || gapCount > 0} onClick={() => void confirmPublish()}>
                  Publish
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {revertOpen && (
        <div className="modal-back" onClick={() => setRevertOpen(false)}>
          <div className="modal confirm" role="dialog" aria-modal="true" aria-label="Revert draft" onClick={(event) => event.stopPropagation()}>
            <h2>Revert draft</h2>
            <p>This puts the draft back to the public site and discards every unpublished change, including other people's.</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setRevertOpen(false)}>Cancel</button>
              <button className="primary" type="button" onClick={() => void confirmRevert()}>Revert draft</button>
            </div>
          </div>
        </div>
      )}
      {settingsOpen && (
        <SettingsModal
          siteName={shownName}
          onClose={() => setSettingsOpen(false)}
          onSaved={(saved) => {
            setShownName(saved.siteName)
            setModelReady(saved.tokenSet)
            document.title = saved.siteName
            setSettingsOpen(false)
            setNotice(null)
            reloadPreview()
          }}
        />
      )}
    </>
  )
}

function ChatConversation({
  sessionId,
  initialMessages,
  mode,
  onBusy,
  onFinished,
  onSaved,
  modelReady,
  onNeedToken,
  undoMessageId,
  undoing,
  onUndo,
  controls,
}: {
  sessionId: string
  initialMessages: UIMessage[]
  mode: EditorMode
  onBusy: (busy: boolean) => void
  onFinished: () => void
  onSaved: () => void
  modelReady: boolean
  onNeedToken: () => void
  undoMessageId: string | null
  undoing: boolean
  onUndo: () => void
  controls: ReactNode
}) {
  const modeRef = useRef(mode)
  modeRef.current = mode
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved
  const sessionRef = useRef(sessionId)
  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: '/api/chat',
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: { ...body, messages, mode: modeRef.current, sessionId: sessionRef.current },
        }),
      }),
    [],
  )
  const { messages, sendMessage, status, error } = useChat({
    id: sessionId,
    messages: initialMessages,
    transport,
    onFinish: ({ message, isAbort, isError }) => {
      if (!isAbort && !isError && message.parts.some((part) => savedChange(part))) onSavedRef.current()
    },
  })
  const busy = status === 'submitted' || status === 'streaming'
  const activity = activityLabel(messages, status)
  const apiError = error ? presentChatError(error.message) : null
  const messagesRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const pictureLock = useRef(false)

  useEffect(() => {
    onBusy(busy)
  }, [busy, onBusy])

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight })
  }, [messages, activity, error])

  return (
    <>
      <div className="messages" ref={messagesRef}>
        {messages.map((message) => {
          const note = message.role === 'assistant' ? unchangedNote(message.parts, status) : null
          return (
          <article className={`msg ${message.role}`} key={message.id}>
            {chatPieces(message.parts).map((piece, index) => {
              if (piece.kind === 'text') return <ChatMarkdown key={index} text={piece.text} />
              if (piece.kind === 'reject') return <p className="gaps" key={index}>{piece.text}</p>
              if (piece.kind === 'error') {
                const failure = presentChatError(piece.text)
                return (
                  <p className="api-error" role="alert" key={index}>
                    <strong>{failure.type}</strong>
                    <span>{failure.description}</span>
                  </p>
                )
              }
              if (piece.kind === 'saves') return <SaveNotes key={index} lines={piece.lines} />
              return <ToolNotes key={index} entries={piece.entries} />
            })}
            {note && <p className="gaps">{note}</p>}
            {message.role === 'assistant' && undoMessageId === message.id && (
              <button type="button" className="undo" disabled={busy || undoing} onClick={onUndo}>
                Undo
              </button>
            )}
          </article>
          )
        })}
        {activity && <p className="working" role="status">{activity}</p>}
        {apiError && (
          <p className="api-error" role="alert">
            <strong>{apiError.type}</strong>
            <span>{apiError.description}</span>
          </p>
        )}
      </div>
      <div className="composer">
        {controls}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (pictureLock.current) return
          const field = draftRef.current
          const value = field?.value.trim() ?? ''
          if (!value || busy) return
          if (!modelReady) {
            onNeedToken()
            return
          }
          if (field) field.value = ''
          void sendMessage({ text: value }).then(() => {
            onFinished()
          })
        }}
      >
        <textarea ref={draftRef} name="draft" rows={5} placeholder={mode === 'setup' ? 'Describe the project, or paste a website to start from' : 'Change a page, a layout, or the shell'} />
        <div className="draft-actions">
          <div className="draft-tools">
            <PictureDesk draftRef={draftRef} onLock={(locked) => { pictureLock.current = locked }} />
          </div>
          <button type="submit" disabled={busy}>{busy ? 'Working…' : 'Send'}</button>
        </div>
      </form>
      </div>
    </>
  )
}

type SuggestOption =
  | { kind: 'group'; label: string }
  | { kind: 'item'; id: string; title: string; detail?: string }

function choiceId(choice: ModelChoice): string {
  return `${choice.provider}::${choice.model}`
}

function choiceById(choices: ModelChoice[], id: string): ModelChoice | undefined {
  return choices.find((choice) => choiceId(choice) === id)
}

function modelOptions(query: string, baseURL: string): SuggestOption[] {
  const options: SuggestOption[] = []
  let provider = ''
  for (const choice of modelSuggestions(query, baseURL)) {
    if (choice.provider !== provider) {
      options.push({ kind: 'group', label: choice.provider })
      provider = choice.provider
    }
    options.push({ kind: 'item', id: choiceId(choice), title: choice.model })
  }
  return options
}

function SuggestField({
  label,
  value,
  onValue,
  options,
  onPick,
}: {
  label: string
  value: string
  onValue: (value: string) => void
  options: SuggestOption[]
  onPick: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const items = options.filter((option): option is Extract<SuggestOption, { kind: 'item' }> => option.kind === 'item')

  useEffect(() => {
    setActive(0)
  }, [value])

  function pick(id: string) {
    onPick(id)
    setOpen(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open) setOpen(true)
      if (items.length === 0) return
      event.preventDefault()
      setActive((index) => {
        const next = event.key === 'ArrowDown' ? index + 1 : index - 1
        return (next + items.length) % items.length
      })
      return
    }
    if (!open) return
    if (event.key === 'Enter' && items[active]) {
      event.preventDefault()
      pick(items[active].id)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <label className="suggest">
      {label}
      <input
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          onValue(event.target.value)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
      />
      {open && options.length > 0 && (
        <div className="suggest-list" role="listbox">
          {options.map((option) =>
            option.kind === 'group' ? (
              <div key={option.label} className="suggest-group">
                {option.label}
              </div>
            ) : (
              <button
                key={option.id}
                type="button"
                role="option"
                data-active={items[active]?.id === option.id ? 'true' : undefined}
                onMouseDown={(event) => {
                  event.preventDefault()
                  pick(option.id)
                }}
              >
                {option.title}
                {option.detail && <span className="detail">{option.detail}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </label>
  )
}

function SettingsModal({
  siteName,
  onClose,
  onSaved,
}: {
  siteName: string
  onClose: () => void
  onSaved: (saved: { siteName: string; tokenSet: boolean }) => void
}) {
  const [name, setName] = useState(siteName)
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [tokenSet, setTokenSet] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void fetch('/api/settings')
      .then((response) => response.json())
      .then((data: { baseURL?: string; model?: string; siteName?: string; tokenSet?: boolean; error?: string }) => {
        if (data.error) {
          setError(data.error)
          return
        }
        setBaseURL(data.baseURL ?? '')
        setModel(data.model ?? '')
        setTokenSet(data.tokenSet === true)
        if (data.siteName) setName(data.siteName)
      })
      .catch(() => setError('Settings could not be loaded.'))
  }, [])

  async function save() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteName: name, baseURL, model, apiKey }),
      })
      const data = (await response.json()) as { error?: string; siteName?: string; tokenSet?: boolean }
      if (!response.ok || data.error || !data.siteName) {
        setError(data.error ?? 'Settings could not be saved.')
        return
      }
      onSaved({ siteName: data.siteName, tokenSet: data.tokenSet === true })
    } catch {
      setError('Settings could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Settings" onClick={(event) => event.stopPropagation()}>
        <h2>Settings</h2>
        <label>
          Site name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <SuggestField
          label="Model address"
          value={baseURL}
          onValue={setBaseURL}
          options={addressSuggestions(baseURL).map((provider) => ({
            kind: 'item' as const,
            id: provider.baseURL,
            title: provider.name,
            detail: provider.baseURL,
          }))}
          onPick={(id) => {
            const provider = providerForBase(id)
            if (!provider) return
            setBaseURL(provider.baseURL)
            setModel((current) => modelAfterProviderPick(current, provider))
          }}
        />
        <SuggestField
          label="Model name"
          value={model}
          onValue={setModel}
          options={modelOptions(model, baseURL)}
          onPick={(id) => {
            const choice = choiceById(modelSuggestions(model, baseURL), id)
            if (!choice) return
            setModel(choice.model)
            setBaseURL(choice.baseURL)
          }}
        />
        <label>
          Token
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            placeholder={tokenSet ? 'Leave blank to keep the current token' : 'Enter a token'}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        {error && <p className="picture-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="button" disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function AccountMenu({ name, picture }: { name: string; picture?: string }) {
  const [open, setOpen] = useState(false)
  const [broken, setBroken] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const initial = name.trim().charAt(0).toUpperCase() || 'E'
  return (
    <div className="account" ref={rootRef}>
      <button type="button" aria-expanded={open} aria-haspopup="menu" aria-label="Account" onClick={() => setOpen((value) => !value)}>
        {picture && !broken ? <img src={picture} alt="" onError={() => setBroken(true)} /> : <span>{initial}</span>}
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <p>{name}</p>
          <a role="menuitem" href="/auth/logout">Log out</a>
        </div>
      )}
    </div>
  )
}

function ToolNotes({ entries }: { entries: { label: string; done: boolean }[] }) {
  const line = (entry: { label: string; done: boolean }) => (entry.done ? entry.label : `${entry.label}…`)
  if (entries.length === 1 && entries[0]) return <p className="tool">{line(entries[0])}</p>
  const running = entries.find((entry) => !entry.done)
  return (
    <details className="fold">
      <summary>{running ? line(running) : `${entries.length} steps`}</summary>
      <ul>
        {entries.map((entry, index) => (
          <li key={index}>{line(entry)}</li>
        ))}
      </ul>
    </details>
  )
}

function SaveNotes({ lines }: { lines: string[] }) {
  const summary = lines.length === 1 ? '1 file updated' : `${lines.length} files updated`
  return (
    <details className="fold saves">
      <summary>{summary}</summary>
      <ul>
        {lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </details>
  )
}

function ChatMarkdown({ text }: { text: string }) {
  return <div className="md">{renderBlocks(parseChatMarkdown(text))}</div>
}

function renderBlocks(blocks: Block[]) {
  return blocks.map((block, index) => {
    if (block.kind === 'pre') return <pre key={index}><code>{block.text}</code></pre>
    if (block.kind === 'ul') {
      return (
        <ul key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>
              {renderInlines(item.inlines)}
              {item.nested.length > 0 && renderBlocks(item.nested)}
            </li>
          ))}
        </ul>
      )
    }
    if (block.kind === 'ol') {
      return (
        <ol key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>
              {renderInlines(item.inlines)}
              {item.nested.length > 0 && renderBlocks(item.nested)}
            </li>
          ))}
        </ol>
      )
    }
    if (block.kind === 'h') {
      const Tag = block.level === 1 ? 'h2' : block.level === 2 ? 'h3' : 'h4'
      return <Tag key={index}>{renderInlines(block.inlines)}</Tag>
    }
    return <p key={index}>{renderInlines(block.inlines)}</p>
  })
}

function renderInlines(inlines: Inline[]) {
  return inlines.map((inline, index) => {
    if (inline.kind === 'strong') return <strong key={index}>{renderInlines(inline.children)}</strong>
    if (inline.kind === 'em') return <em key={index}>{renderInlines(inline.children)}</em>
    if (inline.kind === 'code') return <code key={index}>{inline.text}</code>
    if (inline.kind === 'a') return <a key={index} href={inline.href} target="_blank" rel="noreferrer">{inline.text}</a>
    return <span key={index}>{inline.text}</span>
  })
}
