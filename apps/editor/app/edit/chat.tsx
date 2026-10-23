'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { activityState, savedChange, toolKind, unchangedNote } from '@/lib/activity'
import { toPreviewPath } from '@/lib/site-route'
import { phraseChange } from '@/lib/correct-phrase'
import { presentChatError } from '@/lib/api-error'
import type { Block, Inline } from '@/lib/chat-markdown'
import { parseChatMarkdown } from '@/lib/chat-markdown'
import { chatPieces, madePictures } from '@/lib/chat-pieces'
import type { EditorMode } from '@/lib/mode'
import { uiText, type EditorLanguage } from '@/lib/ui-text'
import { useEditorLanguage } from './language'
import { SetupStart } from './setup-start'
import { TipsCard } from './tips'
import { PictureDesk } from './pictures'
import { SettingsDrawer } from './settings'
import { TopBar } from './topbar'
import { pageForPath, previewAddress, type PageEntry } from '@/lib/page-match'

type SessionSummary = {
  id: string
  title: string
  mode: EditorMode
  updatedAt: number
  empty?: boolean
}

type ChatRecord = SessionSummary & {
  messages: UIMessage[]
}

type PreviewDevice = 'desktop' | 'phone'

function elementFrom(target: EventTarget | null): Element | null {
  if (!target || typeof target !== 'object') return null
  const node = target as Node
  if (node.nodeType === 3) return node.parentElement
  if (node.nodeType === 1) return node as Element
  return null
}

/** A chat as the picker names it. A chat without a name yet is told apart by when it was made. */
function chatLabel(session: SessionSummary, language: EditorLanguage): string {
  if (session.title !== 'New chat') return session.title
  const at = new Date(session.updatedAt)
  const today = new Date().toDateString() === at.toDateString()
  const when = today ? at.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' }) : at.toLocaleString(language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return `${uiText(language, 'chat.newTitle')} · ${when}`
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
  const [undoIds, setUndoIds] = useState<string[]>([])
  const [undoing, setUndoing] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLIFrameElement>(null)
  const [previewSrc, setPreviewSrc] = useState('/preview/')
  const [shownName, setShownName] = useState(siteName)
  const [modelReady, setModelReady] = useState(tokenSet)
  const [settingsOpen, setSettingsOpen] = useState(!tokenSet)
  const [language, setLanguage] = useEditorLanguage()
  const [setupActive, setSetupActive] = useState(setupOpen)
  const [skipError, setSkipError] = useState('')
  const [tipsOpen, setTipsOpen] = useState(false)
  const [pages, setPages] = useState<PageEntry[]>([])
  const [shownPath, setShownPath] = useState('/preview/')
  const [device, setDevice] = useState<PreviewDevice>('desktop')
  const [tab, setTab] = useState<'chat' | 'preview'>('chat')
  const [previewNews, setPreviewNews] = useState(false)
  const [changeCount, setChangeCount] = useState<number | null>(null)
  const fillDraftRef = useRef<(text: string) => void>(() => {})
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
        const opened = data.current
        // A fresh site opens in setup, with the scripted questions. A chat that has been used is left as it is.
        if (setupOpen && opened.messages.length === 0 && opened.mode !== 'setup') {
          opened.mode = 'setup'
          void fetch(`/api/sessions/${opened.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'setup' }),
          })
        }
        // A chat that stayed in setup after the setup was accepted goes back to editing.
        if (!setupOpen && opened.mode === 'setup') {
          opened.mode = 'edit'
          void patchMode(opened.id, 'edit')
        }
        setSessions(data.sessions.map((session) => (session.id === opened.id ? { ...session, mode: opened.mode } : session)))
        setCurrent(opened)
      })
    refreshUndo()
    refreshChanges()
    refreshPages()
  }, [])

  function refreshUndo() {
    void fetch('/api/draft')
      .then((response) => response.json())
      .then((data: { undos?: { messageId: string }[] }) => {
        setUndoIds((data.undos ?? []).map((item) => item.messageId))
      })
  }

  function refreshChanges() {
    void fetch('/api/publish')
      .then((response) => response.json())
      .then((data: { changes?: string[] }) => {
        if (Array.isArray(data.changes)) setChangeCount(data.changes.length)
      })
      .catch(() => {})
  }

  function refreshPages() {
    void fetch('/api/pages')
      .then((response) => response.json())
      .then((data: { pages?: PageEntry[] }) => {
        if (Array.isArray(data.pages)) setPages(data.pages)
      })
      .catch(() => {})
  }

  function noteShownPath() {
    try {
      const pathname = previewRef.current?.contentWindow?.location.pathname
      if (pathname) setShownPath(pathname)
    } catch {
      // The preview is the site's own page; if it cannot be read, the switcher keeps what it had.
    }
  }

  function openPage(slug: string) {
    const entry = pages.find((page) => page.slug === slug)
    if (!entry) return
    setPreviewSrc(previewAddress(entry, pageForPath(pages, shownPath)?.lang ?? null))
    setTab('preview')
    setPreviewNews(false)
  }

  function patchMode(id: string, mode: EditorMode): Promise<unknown> {
    return fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
    })
  }

  function remember(opened: ChatRecord) {
    // Only a setup that is still open has chats in setup mode.
    let next = opened
    if (!setupActive && opened.mode === 'setup') {
      next = { ...opened, mode: 'edit' }
      void patchMode(opened.id, 'edit')
    }
    setCurrent(next)
    setSessions((list) => [{ ...next, empty: next.messages.length === 0 }, ...list.filter((session) => session.id !== next.id)])
    setConfirmDelete(false)
  }

  function focusDraft() {
    setTimeout(() => fillDraftRef.current(''), 80)
  }

  async function openSession(id: string) {
    if (streamBusy || id === current?.id) return
    const response = await fetch(`/api/sessions/${id}`)
    if (!response.ok) return
    remember((await response.json()) as ChatRecord)
  }

  async function createSession() {
    if (streamBusy) return
    // An empty chat is already a new chat: open it instead of adding another.
    const waiting = sessions.find((session) => session.empty)
    if (waiting) {
      if (waiting.id !== current?.id) await openSession(waiting.id)
      focusDraft()
      return
    }
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: setupActive ? 'setup' : 'edit' }),
    })
    if (!response.ok) return
    remember((await response.json()) as ChatRecord)
    focusDraft()
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

  function refreshSetup() {
    void fetch('/api/setup')
      .then((response) => response.json())
      .then((data: { accepted?: boolean }) => {
        if (data.accepted !== true) return
        setSetupActive(false)
        // The setup is done, so this chat goes back to editing. The server saves that too when a reply ends.
        setCurrent((record) => (record && record.mode === 'setup' ? { ...record, mode: 'edit' } : record))
        setSessions((list) => list.map((item) => (item.mode === 'setup' ? { ...item, mode: 'edit' } : item)))
      })
  }

  async function skipSetup() {
    setSkipError('')
    const response = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'skip' }),
    })
    if (!response.ok) {
      setSkipError(uiText(language, 'setup.skipFailed'))
      return
    }
    setSetupActive(false)
    selectMode('edit')
    reloadPreview()
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
    url.pathname = toPreviewPath(url.pathname)
    url.searchParams.set('v', String(Date.now()))
    setPreviewSrc(`${url.pathname}${url.search}${url.hash}`)
    refreshChanges()
    refreshPages()
    if (tab === 'chat') setPreviewNews(true)
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
      setNotice({ text: uiText(language, 'notice.published'), bad: false })
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
    setUndoIds([])
    setNotice({ text: uiText(language, 'notice.reverted'), bad: false })
    reloadPreview()
  }

  async function undoReply(messageId: string) {
    setNotice(null)
    setUndoing(true)
    try {
      const response = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'undo', messageId }),
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok || data.error) {
        setNotice({ text: data.error ?? 'That reply could not be undone.', bad: true })
        return
      }
      setNotice({ text: uiText(language, 'chat.undone'), bad: false })
      refreshUndo()
      reloadPreview()
    } finally {
      setUndoing(false)
    }
  }

  const t = (key: Parameters<typeof uiText>[1], values?: Record<string, string | number>) => uiText(language, key, values)
  const shown = pageForPath(pages, shownPath)

  return (
    <>
    <div className="app">
    <TopBar
      language={language}
      siteName={shownName}
      changes={changeCount}
      publishBusy={publishBusy}
      onPublish={() => void openPublish()}
      onRevert={() => setRevertOpen(true)}
      onSettings={() => setSettingsOpen(true)}
      onTips={() => setTipsOpen(true)}
      accountName={accountName}
      accountPicture={accountPicture}
    />
    <div className="shell" ref={shellRef} data-tab={tab}>
      <section className="chat">
        {current && (
          <div className="chat-header">
            {confirmDelete ? (
              <>
                <span className="chat-header-ask">{t('chat.deleteAsk')}</span>
                <button type="button" className="danger-button" onClick={() => void deleteSession()}>{t('chat.deleteYes')}</button>
                <button type="button" className="quiet-button" onClick={() => setConfirmDelete(false)}>{t('chat.keep')}</button>
              </>
            ) : (
              <>
                <select aria-label={t('chat.picker')} value={current.id} disabled={streamBusy} onChange={(event) => void openSession(event.target.value)}>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {chatLabel(session, language)}
                    </option>
                  ))}
                </select>
                {setupActive && current.mode === 'setup' && (
                  <span className="pill" role="status" title={t('chat.setupHelp')}>
                    {t('chat.setup')}
                  </span>
                )}
                {setupActive && current.mode === 'setup' && (
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={streamBusy}
                    onClick={() => {
                      if (window.confirm(t('chat.finishSetupAsk'))) void skipSetup()
                    }}
                  >
                    {t('chat.finishSetup')}
                  </button>
                )}
                <button type="button" className="quiet-button" disabled={streamBusy} onClick={() => void createSession()}>
                  + {t('chat.new')}
                </button>
                <button type="button" className="icon-button small" aria-label={t('chat.delete')} title={t('chat.delete')} disabled={streamBusy} onClick={() => setConfirmDelete(true)}>
                  ⌫
                </button>
              </>
            )}
          </div>
        )}
        {notice && <p className={notice.bad ? 'error' : 'notice'} role={notice.bad ? 'alert' : 'status'}>{notice.text}</p>}
        {current && (
          <ChatConversation
            key={current.id}
            sessionId={current.id}
            initialMessages={current.messages}
            mode={current.mode ?? 'edit'}
            onBusy={setStreamBusy}
            onFinished={() => {
              refreshUndo()
              refreshChanges()
              if (setupActive) refreshSetup()
              void fetch('/api/sessions')
                .then((response) => response.json())
                .then((data: { sessions?: SessionSummary[] }) => {
                  if (data.sessions) setSessions(data.sessions)
                })
            }}
            onSaved={reloadPreview}
            language={language}
            fillDraftRef={fillDraftRef}
            setupStart={setupActive}
            onSkipSetup={() => void skipSetup()}
            skipError={skipError}
            modelReady={modelReady}
            onNeedToken={() => {
              setNotice({ text: t('notice.needToken'), bad: true })
              setSettingsOpen(true)
            }}
            undoIds={undoIds}
            undoing={undoing}
            onUndo={(messageId) => void undoReply(messageId)}
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
        <div className="preview-bar">
          <label className="edit-mode">
            <input
              type="checkbox"
              role="switch"
              checked={correcting}
              aria-describedby="edit-mode-tip"
              onChange={() => {
                setCorrectError('')
                setCorrecting((value) => !value)
              }}
            />
            <span className="edit-mode-switch" aria-hidden="true" />
            {t('preview.editMode')}
          </label>
          {pages.length > 0 && (
            <label className="page-switch" title={t('bar.pageHelp')}>
              <span className="page-label">{t('bar.page')}</span>
              <select aria-label={t('bar.page')} value={shown?.entry.slug ?? ''} onChange={(event) => event.target.value && openPage(event.target.value)}>
                {!shown && <option value="">{t('bar.pageNone')}</option>}
                {pages.map((page) => (
                  <option key={page.slug} value={page.slug}>
                    {page.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="edit-mode-tip" id="edit-mode-tip">{correcting ? t('preview.editHint') : ''}</span>
          <div className="segmented device-switch" role="group" aria-label={t('bar.device')}>
            <button type="button" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}>
              {t('bar.desktop')}
            </button>
            <button type="button" aria-pressed={device === 'phone'} onClick={() => setDevice('phone')}>
              {t('bar.phone')}
            </button>
          </div>
          <button type="button" className="quiet-button" onClick={reloadPreview}>{t('preview.reload')}</button>
        </div>
        <div className="preview-stage" data-device={device}>
          <iframe
            title="Draft preview"
            ref={previewRef}
            src={previewSrc}
            onLoad={() => {
              syncCorrectionRef.current()
              noteShownPath()
            }}
          />
        </div>
        {correctError ? <p className="correct-note">{correctError}</p> : null}
      </section>
    </div>
    <nav className="tabs" aria-label={t('tabs.label')}>
      <button type="button" aria-pressed={tab === 'chat'} onClick={() => setTab('chat')}>
        {t('tabs.chat')}
      </button>
      <button
        type="button"
        aria-pressed={tab === 'preview'}
        onClick={() => {
          setTab('preview')
          setPreviewNews(false)
        }}
      >
        {t('tabs.preview')}
        {previewNews && <span className="tab-dot" role="img" aria-label={t('tabs.news')} />}
      </button>
    </nav>
    </div>
      {publishOpen && (
        <div className="modal-back" onClick={() => setPublishOpen(false)}>
          <div className="modal confirm" role="dialog" aria-modal="true" aria-label={t('publish.title')} onClick={(event) => event.stopPropagation()}>
            <h2>{t('publish.title')}</h2>
            {gapCount > 0 && <p className="gaps">{t('publish.gaps', { count: gapCount, sample: gapSample.join(', ') })}</p>}
            {!publishEnabled && <p className="gaps">{t('publish.off')}</p>}
            {publishChanges.length === 0 ? (
              <p>{t('publish.nothing')}</p>
            ) : (
              <ul className="publish-list">
                {publishChanges.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ul>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setPublishOpen(false)}>{t('modal.cancel')}</button>
              {publishChanges.length > 0 && (
                <button className="primary" type="button" disabled={publishBusy || !publishEnabled || gapCount > 0} onClick={() => void confirmPublish()}>
                  {t('publish.confirm')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {revertOpen && (
        <div className="modal-back" onClick={() => setRevertOpen(false)}>
          <div className="modal confirm" role="dialog" aria-modal="true" aria-label={t('revert.title')} onClick={(event) => event.stopPropagation()}>
            <h2>{t('revert.title')}</h2>
            <p>{t('revert.text')}</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setRevertOpen(false)}>{t('modal.cancel')}</button>
              <button className="primary" type="button" onClick={() => void confirmRevert()}>{t('revert.title')}</button>
            </div>
          </div>
        </div>
      )}
      {tipsOpen && (
        <div className="modal-back" onClick={() => setTipsOpen(false)}>
          <div className="modal tips-modal" role="dialog" aria-modal="true" aria-label={uiText(language, 'tips.heading')} onClick={(event) => event.stopPropagation()}>
            <TipsCard
              language={language}
              onExample={(text) => {
                setTipsOpen(false)
                fillDraftRef.current(text)
              }}
            />
            <div className="modal-actions">
              <button type="button" onClick={() => setTipsOpen(false)}>{uiText(language, 'tips.close')}</button>
            </div>
          </div>
        </div>
      )}
      {settingsOpen && (
        <SettingsDrawer
          siteName={shownName}
          language={language}
          onLanguage={setLanguage}
          needToken={!modelReady}
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
  language,
  fillDraftRef,
  setupStart,
  onSkipSetup,
  skipError,
  modelReady,
  onNeedToken,
  undoIds,
  undoing,
  onUndo,
}: {
  sessionId: string
  initialMessages: UIMessage[]
  mode: EditorMode
  onBusy: (busy: boolean) => void
  onFinished: () => void
  onSaved: () => void
  language: EditorLanguage
  fillDraftRef: { current: (text: string) => void }
  setupStart: boolean
  onSkipSetup: () => void
  skipError: string
  modelReady: boolean
  onNeedToken: () => void
  undoIds: string[]
  undoing: boolean
  onUndo: (messageId: string) => void
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
  const activity = activityState(messages, status)
  const apiError = error ? presentChatError(error.message) : null
  const messagesRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const pictureLock = useRef(false)
  const placeholder = uiText(language, mode === 'setup' ? 'composer.placeholderSetup' : 'composer.placeholder')

  function growDraft() {
    const field = draftRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, 240)}px`
  }

  function submitDraft() {
    if (pictureLock.current) return
    const field = draftRef.current
    const value = field?.value.trim() ?? ''
    if (!value || busy) return
    if (!modelReady) {
      onNeedToken()
      return
    }
    if (field) {
      field.value = ''
      growDraft()
    }
    void sendMessage({ text: value }).then(() => {
      onFinished()
    })
  }

  useEffect(() => {
    onBusy(busy)
  }, [busy, onBusy])

  useEffect(() => {
    fillDraftRef.current = (text: string) => {
      const field = draftRef.current
      if (!field) return
      field.value = text
      growDraft()
      field.focus()
      field.setSelectionRange(text.length, text.length)
    }
  }, [fillDraftRef])

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight })
  }, [messages, activity?.kind, error])

  return (
    <>
      <div className="messages" ref={messagesRef}>
        {messages.map((message) => {
          const note = message.role === 'assistant' ? unchangedNote(message.parts, status) : null
          const pieces = chatPieces(message.parts)
          const work = {
            entries: pieces.flatMap((piece) => (piece.kind === 'tools' ? piece.entries : [])),
            lines: pieces.flatMap((piece) => (piece.kind === 'saves' ? piece.lines : [])),
          }
          let workShown = false
          return (
          <article className={`msg ${message.role}`} key={message.id}>
            {pieces.map((piece, index) => {
              if (piece.kind === 'text') return <ChatMarkdown key={index} text={piece.text} />
              if (piece.kind === 'error') {
                const failure = presentChatError(piece.text)
                return (
                  <p className="api-error" role="alert" key={index}>
                    <strong>{failure.type}</strong>
                    <span>{failure.description}</span>
                  </p>
                )
              }
              if (workShown) return null
              workShown = true
              return <WorkNotes key={index} language={language} entries={work.entries} lines={work.lines} />
            })}
            {madePictures(message.parts).length > 0 && (
              <div className="made-pictures">
                {madePictures(message.parts).map((picture) => (
                  <img
                    key={picture.file}
                    src={`/api/pictures/raw?file=${encodeURIComponent(picture.file)}&w=360`}
                    alt={picture.file}
                    title={picture.generated ? `${picture.file} — ${uiText(language, 'chat.generated')}` : picture.file}
                    loading="lazy"
                  />
                ))}
              </div>
            )}
            {note && <p className="gaps">{uiText(language, 'chat.unchanged')}</p>}
            {message.role === 'assistant' && undoIds.includes(message.id) && (
              <button type="button" className="undo" title={uiText(language, 'chat.undoTitle')} disabled={busy || undoing} onClick={() => onUndo(message.id)}>
                ↩ {uiText(language, 'chat.undo')}
              </button>
            )}
          </article>
          )
        })}
        {setupStart && mode === 'setup' && messages.length === 0 && !busy && (
          <SetupStart
            language={language}
            disabled={busy}
            skipError={skipError}
            onSkip={onSkipSetup}
            onSend={(text) => {
              if (!modelReady) {
                onNeedToken()
                return
              }
              void sendMessage({ text }).then(() => onFinished())
            }}
          />
        )}
        {messages.length === 0 && !busy && !(setupStart && mode === 'setup') && (
          <TipsCard language={language} onExample={(text) => fillDraftRef.current(text)} />
        )}
        {activity && <p className="working" role="status">{activityText(language, activity)}</p>}
        {apiError && (
          <p className="api-error" role="alert">
            <strong>{apiError.type}</strong>
            <span>{apiError.description}</span>
          </p>
        )}
      </div>
      <div className="composer">
        <form
          className="draft"
          onSubmit={(event) => {
            event.preventDefault()
            submitDraft()
          }}
        >
          <textarea
            ref={draftRef}
            name="draft"
            rows={2}
            aria-label={placeholder}
            placeholder={placeholder}
            onInput={growDraft}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
              if (!window.matchMedia('(pointer: fine)').matches) return
              event.preventDefault()
              submitDraft()
            }}
          />
          <div className="draft-actions">
            <div className="draft-tools">
              <PictureDesk draftRef={draftRef} onLock={(locked) => { pictureLock.current = locked }} />
            </div>
            <button type="submit" className="send" disabled={busy}>{busy ? uiText(language, 'composer.working') : uiText(language, 'composer.send')}</button>
          </div>
          <p className="draft-hint">{uiText(language, 'composer.hint')}</p>
        </form>
      </div>
    </>
  )
}

function activityText(language: EditorLanguage, activity: NonNullable<ReturnType<typeof activityState>>): string {
  if (activity.kind === 'thinking') return uiText(language, 'activity.thinking')
  if (activity.kind === 'writing') return uiText(language, 'activity.writing')
  return uiText(language, `activity.${toolKind(activity.tool)}`)
}

// Everything a reply did, folded into one line: the steps it took and the changes it saved.
function WorkNotes({ language, entries, lines }: { language: EditorLanguage; entries: { label: string; done: boolean }[]; lines: string[] }) {
  const running = entries.find((entry) => !entry.done)
  const steps = entries.length === 1 ? uiText(language, 'chat.stepOne') : uiText(language, 'chat.steps', { count: entries.length })
  const saved = lines.length === 0 ? '' : lines.length === 1 ? uiText(language, 'chat.savedOne') : uiText(language, 'chat.savedMany', { count: lines.length })
  const summary = [entries.length > 0 ? (running ? `${running.label}…` : steps) : '', saved].filter(Boolean).join(' · ')
  return (
    <details className="work">
      <summary data-busy={running ? 'true' : undefined}>{summary}</summary>
      {lines.length > 0 && (
        <ul className="work-saves">
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
      {entries.length > 0 && (
        <ul className="work-steps">
          {entries.map((entry, index) => (
            <li key={index}>{entry.done ? entry.label : `${entry.label}…`}</li>
          ))}
        </ul>
      )}
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
