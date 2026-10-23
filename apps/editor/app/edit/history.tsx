'use client'

import { useCallback, useEffect, useState } from 'react'
import type { HistoryEntry } from '@/lib/history-log'
import type { RevisionChange } from '@/lib/changes'
import { uiText, type EditorLanguage, type TextKey } from '@/lib/ui-text'

const PAGE = 50

function when(date: string, language: EditorLanguage): string {
  const time = new Date(date)
  if (Number.isNaN(time.getTime())) return ''
  return time.toLocaleString(language === 'de' ? 'de-AT' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

// ---------------------------------------------------------------------------------------------------------------------
// The list: every change of the draft, newest first, with the public site and the newest change marked.

export function HistoryList({
  language,
  selected,
  reloadKey,
  onSelect,
}: {
  language: EditorLanguage
  selected: string | null
  reloadKey: number
  onSelect: (revision: string) => void
}) {
  const t = (key: TextKey, values?: Record<string, string | number>) => uiText(language, key, values)
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void fetch(`/api/history?limit=${PAGE}`)
      .then((response) => response.json())
      .then((data: { entries?: HistoryEntry[]; total?: number; error?: string }) => {
        if (!live) return
        if (data.error) setError(data.error)
        else {
          setError('')
          setEntries(data.entries ?? [])
          setTotal(data.total ?? 0)
        }
      })
      .catch(() => live && setError('Could not load the history.'))
    return () => {
      live = false
    }
  }, [reloadKey])

  async function more() {
    if (!entries) return
    setBusy(true)
    try {
      const response = await fetch(`/api/history?skip=${entries.length}&limit=${PAGE}`)
      const data = (await response.json()) as { entries?: HistoryEntry[]; total?: number }
      setEntries([...entries, ...(data.entries ?? [])])
      setTotal(data.total ?? total)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="browser history">
      <div className="browser-list">
        {error && <p className="error" role="alert">{error}</p>}
        {!entries && !error && <p className="browser-note">{t('history.loading')}</p>}
        {entries && entries.length === 0 && <p className="browser-note">{t('history.empty')}</p>}
        <ol className="commit-list">
          {entries?.map((entry) => (
            <li key={entry.revision}>
              <button type="button" className="commit-row" aria-current={selected === entry.revision ? 'true' : undefined} onClick={() => onSelect(entry.revision)}>
                <span className="commit-top">
                  <span className={`kind kind-${entry.kind}`}>{t(`history.kind.${entry.kind}` as TextKey)}</span>
                  {entry.isHead && <span className="pill head">{t('history.now')}</span>}
                  {entry.isPublic && <span className="pill public">{t('history.public')}</span>}
                </span>
                <span className="commit-subject">{entry.subject}</span>
                <span className="commit-meta">
                  {t('history.by', { name: entry.author })} · {when(entry.date, language)}
                </span>
              </button>
            </li>
          ))}
        </ol>
        {entries && entries.length < total && (
          <button type="button" className="quiet-button more" disabled={busy} onClick={() => void more()}>
            {t('history.more')}
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// One change: who made it, the files it touched, the lines it made, and what can be done with it.

type Detail = { entry: HistoryEntry; changes: RevisionChange[] }
type Action = { kind: 'restore' | 'restoreFile' | 'undo'; file?: string; sentences: string[] }

export function CommitView({
  language,
  revision,
  reloadKey,
  onChanged,
  onClose,
}: {
  language: EditorLanguage
  revision: string
  reloadKey: number
  /** The draft changed: the preview, the lists and the counts have to be read again. */
  onChanged: () => void
  onClose: () => void
}) {
  const t = (key: TextKey, values?: Record<string, string | number>) => uiText(language, key, values)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  // A different change starts clean; a reload after an action keeps what is shown, and the notice with it.
  useEffect(() => {
    setDetail(null)
    setOpen(null)
    setAction(null)
    setDone(false)
    setError('')
  }, [revision])

  useEffect(() => {
    let live = true
    void fetch(`/api/history?revision=${revision}`)
      .then((response) => response.json())
      .then((data: Detail & { error?: string }) => {
        if (!live) return
        if (data.error) setError(data.error)
        else setDetail(data)
      })
      .catch(() => live && setError('Could not open that change.'))
    return () => {
      live = false
    }
  }, [revision, reloadKey])

  async function ask(kind: Action['kind'], file?: string) {
    setError('')
    setDone(false)
    if (kind === 'undo') {
      setAction({ kind, sentences: detail?.changes.map((change) => change.sentence) ?? [] })
      return
    }
    try {
      const response = await fetch('/api/history', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'preview', revision, file }),
      })
      const data = (await response.json()) as { sentences?: string[]; error?: string }
      if (!response.ok) setError(data.error ?? 'That could not be checked.')
      else setAction({ kind, file, sentences: data.sentences ?? [] })
    } catch {
      setError('That could not be checked.')
    }
  }

  async function confirm() {
    if (!action) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/history', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: action.kind, revision, file: action.file }),
      })
      const data = (await response.json()) as { error?: string }
      setAction(null)
      if (!response.ok) setError(data.error ?? 'That did not work.')
      else {
        setDone(true)
        onChanged()
      }
    } catch {
      setAction(null)
      setError('That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const entry = detail?.entry
  return (
    <div className="editor-pane">
      <div className="pane-head">
        <button type="button" className="quiet-button" onClick={onClose}>← {t('pane.back')}</button>
        {entry && <span className={`kind kind-${entry.kind}`}>{t(`history.kind.${entry.kind}` as TextKey)}</span>}
        {entry?.isHead && <span className="pill head">{t('history.now')}</span>}
        {entry?.isPublic && <span className="pill public">{t('history.public')}</span>}
      </div>
      <div className="pane-body">
        {error && <p className="error" role="alert">{error}</p>}
        {done && <p className="notice" role="status">{t('history.done')}</p>}
        {!detail && !error && <p className="browser-note">{t('history.loading')}</p>}
        {entry && detail && (
          <>
            <h2 className="commit-title">{entry.subject}</h2>
            <p className="commit-meta">
              {t('history.by', { name: entry.author })} · {when(entry.date, language)} · <code>{entry.short}</code>
            </p>
            <div className="commit-actions">
              {!entry.isHead && (
                <button type="button" onClick={() => void ask('restore')}>{t('history.restoreDraft')}</button>
              )}
              {detail.changes.length > 0 && entry.kind !== 'initial' && (
                <button type="button" onClick={() => void ask('undo')}>↩ {t('history.undo')}</button>
              )}
            </div>
            <h3>{t('history.files')}</h3>
            {detail.changes.length === 0 && <p className="browser-note">{t('history.noFiles')}</p>}
            <ul className="change-list">
              {detail.changes.map((change) => (
                <li key={change.file}>
                  <button type="button" className="change-row" aria-expanded={open === change.file} onClick={() => setOpen(open === change.file ? null : change.file)}>
                    <span className={`status status-${change.status}`}>{change.status === 'A' ? t('history.added') : change.status === 'D' ? t('history.removed') : t('history.changed')}</span>
                    <span className="change-sentence">{change.sentence}</span>
                    <code className="change-file">{change.file}</code>
                  </button>
                  {open === change.file && (
                    <div className="change-detail">
                      <FileChange language={language} revision={revision} change={change} />
                      {!entry.isHead && (
                        <button type="button" className="quiet-button" onClick={() => void ask('restoreFile', change.file)}>{t('history.restoreFile')}</button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {action && (
        <div className="modal-back" onClick={() => setAction(null)}>
          <div className="modal confirm" role="dialog" aria-modal="true" aria-label={t(action.kind === 'restore' ? 'history.confirmRestore' : action.kind === 'restoreFile' ? 'history.confirmFile' : 'history.confirmUndo')} onClick={(event) => event.stopPropagation()}>
            <h2>{t(action.kind === 'restore' ? 'history.confirmRestore' : action.kind === 'restoreFile' ? 'history.confirmFile' : 'history.confirmUndo')}</h2>
            <p>{action.kind === 'undo' ? t('history.undoText') : action.sentences.length === 0 ? t('history.nothingToChange') : t('history.restoreText')}</p>
            {action.sentences.length > 0 && (
              <ul className="publish-list">
                {action.sentences.map((sentence, index) => (
                  <li key={`${index}-${sentence}`}>{sentence}</li>
                ))}
              </ul>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setAction(null)}>{uiText(language, 'modal.cancel')}</button>
              <button className="primary" type="button" disabled={busy || (action.kind !== 'undo' && action.sentences.length === 0)} onClick={() => void confirm()}>
                {t(action.kind === 'restore' ? 'history.confirmRestore' : action.kind === 'restoreFile' ? 'history.confirmFile' : 'history.confirmUndo')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const PICTURE = /^media\/.+\.(?:jpe?g|png|webp|gif|svg)$/i

function FileChange({ language, revision, change }: { language: EditorLanguage; revision: string; change: RevisionChange }) {
  const t = (key: TextKey) => uiText(language, key)
  const [diff, setDiff] = useState<{ text: string; cut: boolean } | null>(null)
  const [error, setError] = useState('')
  const picture = PICTURE.test(change.file)
  const load = useCallback(() => {
    if (picture) return
    void fetch(`/api/history?revision=${revision}&file=${encodeURIComponent(change.file)}`)
      .then((response) => response.json())
      .then((data: { text?: string; cut?: boolean; error?: string }) => {
        if (data.error) setError(data.error)
        else setDiff({ text: data.text ?? '', cut: data.cut === true })
      })
      .catch(() => setError('Could not load the lines.'))
  }, [revision, change.file, picture])
  useEffect(load, [load])

  if (picture) {
    const url = (side: 'before' | 'after') => `/api/history/picture?revision=${revision}&file=${encodeURIComponent(change.file)}&side=${side}`
    return (
      <div className="picture-compare">
        {change.status !== 'A' && (
          <figure>
            <img src={url('before')} alt="" />
            <figcaption>{t('history.before')}</figcaption>
          </figure>
        )}
        {change.status !== 'D' && (
          <figure>
            <img src={url('after')} alt="" />
            <figcaption>{t('history.after')}</figcaption>
          </figure>
        )}
      </div>
    )
  }
  if (error) return <p className="error" role="alert">{error}</p>
  if (!diff) return <p className="browser-note">{t('history.loading')}</p>
  const lines = diff.text.split('\n').filter((line) => !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode)/.test(line))
  if (lines.every((line) => !line.trim())) return <p className="browser-note">{t('history.noLines')}</p>
  return (
    <pre className="diff" tabIndex={0}>
      {lines.map((line, index) => (
        <span key={index} className={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'hunk' : undefined}>
          {line + '\n'}
        </span>
      ))}
      {diff.cut && <span className="hunk">{t('history.cut')}</span>}
    </pre>
  )
}
