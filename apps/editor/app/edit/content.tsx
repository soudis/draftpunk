'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ContentEntry, ContentForm, FormField, Label } from '@/lib/content-form'
import { uiText, type EditorLanguage, type TextKey } from '@/lib/ui-text'
import { MarkdownEditor } from './markdown-editor'

export type OpenTarget = { kind: 'content' | 'design'; file: string }

type DesignEntry = { file: string; title: string }
type Hit = { file: string; line: number; text: string }

const EVENT_PAGE = 40

// ---------------------------------------------------------------------------------------------------------------------
// The navigator: pages, events, places, the two lists, and the design texts that can be read.

export function ContentBrowser({
  language,
  selected,
  reloadKey,
  onOpen,
}: {
  language: EditorLanguage
  selected: OpenTarget | null
  reloadKey: number
  onOpen: (target: OpenTarget) => void
}) {
  const t = (key: TextKey, values?: Record<string, string | number>) => uiText(language, key, values)
  const [entries, setEntries] = useState<ContentEntry[] | null>(null)
  const [design, setDesign] = useState<DesignEntry[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [eventsShown, setEventsShown] = useState(EVENT_PAGE)

  useEffect(() => {
    let live = true
    void fetch('/api/content')
      .then((response) => response.json())
      .then((data: { entries?: ContentEntry[]; design?: DesignEntry[]; error?: string }) => {
        if (!live) return
        if (data.error) setError(data.error)
        else {
          setEntries(data.entries ?? [])
          setDesign(data.design ?? [])
          setError('')
        }
      })
      .catch(() => live && setError('Could not load the content.'))
    return () => {
      live = false
    }
  }, [reloadKey])

  useEffect(() => {
    const needle = query.trim()
    if (needle.length < 2) {
      setHits([])
      return
    }
    let live = true
    const timer = window.setTimeout(() => {
      void fetch(`/api/content?q=${encodeURIComponent(needle)}`)
        .then((response) => response.json())
        .then((data: { hits?: Hit[] }) => live && setHits(data.hits ?? []))
        .catch(() => {})
    }, 250)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [query, reloadKey])

  const needle = query.trim().toLowerCase()
  const matches = (title: string, file: string) => !needle || title.toLowerCase().includes(needle) || file.toLowerCase().includes(needle)
  const groups = useMemo(() => {
    const all = entries ?? []
    const pick = (kinds: string[]) => all.filter((entry) => kinds.includes(entry.kind) && matches(entry.title, entry.file))
    return {
      page: pick(['page']).sort((a, b) => a.sort.localeCompare(b.sort)),
      event: pick(['event']).sort((a, b) => b.sort.localeCompare(a.sort)),
      place: pick(['place']).sort((a, b) => a.sort.localeCompare(b.sort)),
      list: pick(['home', 'redirects']),
      design: design.filter((entry) => matches(entry.title, entry.file)),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, design, needle])
  const titles = useMemo(() => new Map((entries ?? []).map((entry) => [entry.file, entry.title])), [entries])

  const row = (target: OpenTarget, title: string, sub = '') => (
    <li key={`${target.kind}:${target.file}`}>
      <button
        type="button"
        className="file-row"
        aria-current={selected?.file === target.file && selected.kind === target.kind ? 'true' : undefined}
        onClick={() => onOpen(target)}
      >
        <span className="file-title">{title || target.file}</span>
        {sub && <span className="file-sub">{sub}</span>}
      </button>
    </li>
  )
  const total = groups.page.length + groups.event.length + groups.place.length + groups.list.length + groups.design.length

  return (
    <div className="browser">
      <div className="browser-head">
        <input type="search" value={query} placeholder={t('content.search')} aria-label={t('content.search')} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="browser-list">
        {error && <p className="error" role="alert">{error}</p>}
        {!entries && !error && <p className="browser-note">{t('content.loading')}</p>}
        {entries && total === 0 && hits.length === 0 && <p className="browser-note">{t('content.nothing')}</p>}
        {hits.length > 0 && (
          <section>
            <h3>{t('content.group.hits')}</h3>
            <ul>
              {hits.map((hit, index) => (
                <li key={`${hit.file}:${hit.line}:${index}`}>
                  <button
                    type="button"
                    className="file-row"
                    onClick={() => onOpen({ kind: hit.file.startsWith('design/') ? 'design' : 'content', file: hit.file })}
                  >
                    <span className="file-title">{titles.get(hit.file) ?? hit.file}</span>
                    <span className="file-sub hit-text">{t('content.line', { line: hit.line })}: {hit.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {groups.page.length > 0 && (
          <section>
            <h3>{t('content.group.page')} <span className="count">{groups.page.length}</span></h3>
            <ul>{groups.page.map((entry) => row({ kind: 'content', file: entry.file }, entry.title, entry.sub))}</ul>
          </section>
        )}
        {groups.event.length > 0 && (
          <section>
            <h3>{t('content.group.event')} <span className="count">{groups.event.length}</span></h3>
            <ul>{groups.event.slice(0, needle ? groups.event.length : eventsShown).map((entry) => row({ kind: 'content', file: entry.file }, entry.title, entry.sub))}</ul>
            {!needle && groups.event.length > eventsShown && (
              <button type="button" className="quiet-button more" onClick={() => setEventsShown((count) => count + EVENT_PAGE)}>
                {t('content.more', { count: groups.event.length - eventsShown })}
              </button>
            )}
          </section>
        )}
        {groups.place.length > 0 && (
          <section>
            <h3>{t('content.group.place')} <span className="count">{groups.place.length}</span></h3>
            <ul>{groups.place.map((entry) => row({ kind: 'content', file: entry.file }, entry.title, entry.sub))}</ul>
          </section>
        )}
        {groups.list.length > 0 && (
          <section>
            <h3>{t('content.group.list')}</h3>
            <ul>{groups.list.map((entry) => row({ kind: 'content', file: entry.file }, entry.kind === 'home' ? t('content.home') : t('content.redirects')))}</ul>
          </section>
        )}
        {groups.design.length > 0 && (
          <section>
            <h3>{t('content.group.design')}</h3>
            <ul>{groups.design.map((entry) => row({ kind: 'design', file: entry.file }, entry.title))}</ul>
          </section>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// The editor: one file as a form, or a design text to read.

type Values = Record<string, unknown>

type Context = {
  language: EditorLanguage
  languages: ContentForm['languages']
  links: string[]
  choosePicture: (done: (address: string) => void) => void
}

const text = (label: Label, language: EditorLanguage) => label[language] || label.de

function emptyValue(field: FormField): unknown {
  if (field.type === 'group') return Object.fromEntries((field.fields ?? []).map((inner) => [inner.key, emptyValue(inner)]))
  if (field.type === 'list' || field.type === 'multiselect') return []
  if (field.type === 'toggle') return false
  if (field.translate) return {}
  return ''
}

export function ContentEditor({
  language,
  target,
  refreshKey,
  onSaved,
  onDirty,
  onClose,
}: {
  language: EditorLanguage
  target: OpenTarget
  /** Counts up when something else may have changed the file, such as a chat reply. */
  refreshKey: number
  onSaved: () => void
  onDirty: (dirty: boolean) => void
  onClose: () => void
}) {
  const t = (key: TextKey, values?: Record<string, string | number>) => uiText(language, key, values)
  const [form, setForm] = useState<ContentForm | null>(null)
  const [designText, setDesignText] = useState<string | null>(null)
  const [values, setValues] = useState<Values>({})
  const [original, setOriginal] = useState('')
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [links, setLinks] = useState<string[]>([])
  const [picker, setPicker] = useState<{ done: (address: string) => void } | null>(null)
  const dirty = form !== null && JSON.stringify(values) !== original
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  useEffect(() => onDirty(dirty), [dirty, onDirty])

  const load = useCallback(
    (keepEdits: boolean) => {
      let live = true
      const url = target.kind === 'design' ? `/api/content?design=${encodeURIComponent(target.file)}` : `/api/content?file=${encodeURIComponent(target.file)}`
      void fetch(url)
        .then((response) => response.json())
        .then((data: { form?: ContentForm; text?: string; error?: string }) => {
          if (!live) return
          if (data.error) {
            setError(data.error)
            return
          }
          setError('')
          if (data.form) {
            setDesignText(null)
            setForm(data.form)
            if (!keepEdits) {
              setValues(data.form.values)
              setOriginal(JSON.stringify(data.form.values))
              setStale(false)
            }
          } else {
            setForm(null)
            setDesignText(data.text ?? '')
          }
        })
        .catch(() => live && setError('Could not open that file.'))
      return () => {
        live = false
      }
    },
    [target.file, target.kind],
  )

  useEffect(() => {
    setForm(null)
    setDesignText(null)
    setError('')
    setStatus('idle')
    setStale(false)
    return load(false)
  }, [load])

  // Something else may have changed the file. A form with edits keeps them; the next save says if the file moved on.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (!dirtyRef.current) return load(false)
  }, [refreshKey, load])

  useEffect(() => {
    void fetch('/api/pages')
      .then((response) => response.json())
      .then((data: { pages?: { urls: Record<string, string> }[] }) => {
        const first = Object.keys(data.pages?.[0]?.urls ?? {})[0]
        setLinks((data.pages ?? []).map((page) => page.urls[first]).filter(Boolean))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function save() {
    if (!form || status === 'saving') return
    setStatus('saving')
    setError('')
    try {
      const response = await fetch('/api/content', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: form.file, values, revision: form.revision }),
      })
      const data = (await response.json()) as { form?: ContentForm; error?: string; stale?: boolean }
      if (!response.ok || !data.form) {
        setStale(data.stale === true)
        setError(data.stale ? '' : data.error ?? 'That could not be saved.')
        setStatus('idle')
        return
      }
      setForm(data.form)
      setValues(data.form.values)
      setOriginal(JSON.stringify(data.form.values))
      setStale(false)
      setStatus('saved')
      onSaved()
    } catch {
      setError('That could not be saved.')
      setStatus('idle')
    }
  }

  const context: Context | null = form
    ? { language, languages: form.languages, links, choosePicture: (done) => setPicker({ done }) }
    : null

  return (
    <div
      className="editor-pane"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && form) {
          event.preventDefault()
          void save()
        }
      }}
    >
      <div className="pane-head">
        <button type="button" className="quiet-button" onClick={onClose}>← {t('pane.back')}</button>
        <h2 className="pane-title">{designText !== null ? target.file.replace('design/', '') : form?.kind === 'home' ? t('content.home') : form?.kind === 'redirects' ? t('content.redirects') : form?.title ?? ''}</h2>
        {form?.layout && <span className="pill">{t('content.layout', { name: form.layout })}</span>}
        {dirty && <span className="pill unsaved">{t('content.unsaved')}</span>}
        {form && (
          <button type="button" className="primary save" disabled={!dirty || status === 'saving'} onClick={() => void save()}>
            {status === 'saving' ? t('content.saving') : t('content.save')}
          </button>
        )}
      </div>
      <div className="pane-body">
        {error && <p className="error" role="alert">{error}</p>}
        {stale && (
          <div className="stale" role="alert">
            <p>{t('content.stale')}</p>
            <p>{t('content.staleCompare')}</p>
            <button type="button" onClick={() => load(false)}>{t('content.staleLoad')}</button>
          </div>
        )}
        {status === 'saved' && !dirty && <p className="notice" role="status">{t('content.saved')}</p>}
        {!form && designText === null && !error && <p className="browser-note">{t('content.loading')}</p>}
        {designText !== null && (
          <>
            <p className="gaps">{t('content.readonly')}</p>
            <MarkdownEditor value={designText} readOnly label={target.file} />
          </>
        )}
        {form && context && (
          <div className="form">
            {form.fields.map((field) => (
              <FieldView
                key={field.key}
                field={field}
                value={values[field.key]}
                context={context}
                onChange={(next) => {
                  setStatus('idle')
                  setValues((current) => ({ ...current, [field.key]: next }))
                }}
              />
            ))}
          </div>
        )}
      </div>
      {picker && (
        <PicturePicker
          language={language}
          onClose={() => setPicker(null)}
          onPick={(address) => {
            picker.done(address)
            setPicker(null)
          }}
        />
      )}
      <datalist id="content-links">
        {links.map((link) => (
          <option key={link} value={link} />
        ))}
      </datalist>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// One input of a form. The value of a field is handed down and the new value handed up, so a list or a group is the
// same component again for each of its parts.

function FieldView({ field, value, onChange, context }: { field: FormField; value: unknown; onChange: (next: unknown) => void; context: Context }) {
  const id = useId()
  const label = text(field.label, context.language)
  const heading = (
    <>
      {label}
      {field.required && <span aria-hidden="true"> *</span>}
    </>
  )

  if (field.type === 'group') {
    const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Values) : {}
    const inner = (field.fields ?? []).map((part) => (
      <FieldView key={part.key} field={part} value={record[part.key]} context={context} onChange={(next) => onChange({ ...record, [part.key]: next })} />
    ))
    if (field.flat) return <>{inner}</>
    return (
      <fieldset className="group">
        {label && <legend>{label}</legend>}
        {inner}
      </fieldset>
    )
  }

  if (field.type === 'list') return <ListView field={field} value={value} onChange={onChange} context={context} heading={heading} />

  if (field.type === 'markdown' && field.translate) {
    return <TranslatedMarkdown field={field} value={value} onChange={onChange} context={context} heading={heading} />
  }

  if ((field.type === 'text' || field.type === 'markdown') && field.translate) {
    const record = value && typeof value === 'object' ? (value as Record<string, string>) : {}
    return (
      <div className="field">
        <span className="field-label">{heading}</span>
        {context.languages.map((language) => (
          <label className="lang-row" key={language.id}>
            <span className="lang-tag">{language.id.toUpperCase()}</span>
            <input
              type="text"
              value={record[language.id] ?? ''}
              lang={language.id}
              aria-label={`${label} ${language.label}`}
              onChange={(event) => onChange({ ...record, [language.id]: event.target.value })}
            />
            {field.required && !language.optional && !(record[language.id] ?? '').trim() && <span className="gap">{uiText(context.language, 'content.gap')}</span>}
          </label>
        ))}
      </div>
    )
  }

  const hint = field.hint ? <span className="field-hint">{text(field.hint, context.language)}</span> : null
  const stringValue = typeof value === 'string' ? value : ''

  if (field.type === 'toggle') {
    return (
      <label className="field toggle">
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        <span>{label}</span>
      </label>
    )
  }
  if (field.type === 'select') {
    return (
      <div className="field">
        <label className="field-label" htmlFor={id}>{heading}</label>
        <select id={id} value={stringValue} onChange={(event) => onChange(event.target.value)}>
          <option value="">{uiText(context.language, 'content.none')}</option>
          {!field.options?.some((option) => option.id === stringValue) && stringValue && <option value={stringValue}>{stringValue}</option>}
          {field.options?.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
        {hint}
      </div>
    )
  }
  if (field.type === 'multiselect') {
    const chosen = Array.isArray(value) ? (value as string[]) : []
    return (
      <fieldset className="field checks">
        <legend className="field-label">{heading}</legend>
        {field.options?.map((option) => (
          <label key={option.id}>
            <input
              type="checkbox"
              checked={chosen.includes(option.id)}
              onChange={(event) => onChange(event.target.checked ? [...chosen, option.id] : chosen.filter((item) => item !== option.id))}
            />
            <span>{option.label}</span>
          </label>
        ))}
        {hint}
      </fieldset>
    )
  }
  if (field.type === 'markdown') {
    return (
      <div className="field">
        <span className="field-label">{heading}</span>
        <MarkdownEditor value={stringValue} label={label} onChange={onChange} />
      </div>
    )
  }
  if (field.type === 'image') {
    return (
      <div className="field">
        <label className="field-label" htmlFor={id}>{heading}</label>
        <div className="picture-field">
          {stringValue.startsWith('/media/') && (
            <img src={`/api/pictures/raw?file=${encodeURIComponent(stringValue.slice('/media/'.length))}&w=160`} alt="" />
          )}
          <input id={id} type="text" value={stringValue} placeholder={uiText(context.language, 'content.noPicture')} onChange={(event) => onChange(event.target.value)} />
          <button type="button" onClick={() => context.choosePicture(onChange)}>{uiText(context.language, 'content.choosePicture')}</button>
          {stringValue && <button type="button" className="quiet-button" onClick={() => onChange('')}>{uiText(context.language, 'content.clear')}</button>}
        </div>
        {hint}
      </div>
    )
  }
  const inputType = field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : 'text'
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{heading}</label>
      <input
        id={id}
        type={inputType}
        value={inputType === 'date' ? stringValue.slice(0, 10) : stringValue}
        list={field.type === 'link' ? 'content-links' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint}
    </div>
  )
}

function TranslatedMarkdown({
  field,
  value,
  onChange,
  context,
  heading,
}: {
  field: FormField
  value: unknown
  onChange: (next: unknown) => void
  context: Context
  heading: React.ReactNode
}) {
  const record = value && typeof value === 'object' ? (value as Record<string, string>) : {}
  const [chosen, setChosen] = useState(context.languages[0]?.id ?? 'de')
  const active = context.languages.some((language) => language.id === chosen) ? chosen : context.languages[0]?.id ?? 'de'
  const label = text(field.label, context.language)
  return (
    <div className="field">
      <div className="field-top">
        <span className="field-label">{heading}</span>
        <div className="segmented" role="group" aria-label={label}>
          {context.languages.map((language) => {
            const missing = field.required && !language.optional && !(record[language.id] ?? '').trim()
            return (
              <button key={language.id} type="button" aria-pressed={active === language.id} onClick={() => setChosen(language.id)}>
                {language.id.toUpperCase()}
                {missing && <span className="tab-dot" role="img" aria-label={uiText(context.language, 'content.gap')} />}
              </button>
            )
          })}
        </div>
      </div>
      <MarkdownEditor key={active} value={record[active] ?? ''} label={`${label} ${active.toUpperCase()}`} onChange={(next) => onChange({ ...record, [active]: next })} />
    </div>
  )
}

function ListView({
  field,
  value,
  onChange,
  context,
  heading,
}: {
  field: FormField
  value: unknown
  onChange: (next: unknown) => void
  context: Context
  heading: React.ReactNode
}) {
  const t = (key: TextKey) => uiText(context.language, key)
  const items = Array.isArray(value) ? (value as unknown[]) : []
  const of = field.of as FormField
  const move = (index: number, by: number) => {
    const next = [...items]
    const target = index + by
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }
  return (
    <fieldset className="field list">
      <legend className="field-label">{heading}</legend>
      {field.hint && <span className="field-hint">{text(field.hint, context.language)}</span>}
      <ol>
        {items.map((item, index) => (
          <li key={index}>
            <div className="list-item">
              <FieldView field={{ ...of, label: { de: '', en: '' } }} value={item} context={context} onChange={(next) => onChange(items.map((current, at) => (at === index ? next : current)))} />
            </div>
            <div className="list-tools">
              <button type="button" className="quiet-button" aria-label={t('content.up')} title={t('content.up')} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
              <button type="button" className="quiet-button" aria-label={t('content.down')} title={t('content.down')} disabled={index === items.length - 1} onClick={() => move(index, 1)}>↓</button>
              <button type="button" className="quiet-button" aria-label={t('content.remove')} title={t('content.remove')} onClick={() => onChange(items.filter((_, at) => at !== index))}>✕</button>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="add" onClick={() => onChange([...items, emptyValue(of)])}>+ {t('content.add')}</button>
    </fieldset>
  )
}

// ---------------------------------------------------------------------------------------------------------------------

type PictureRow = { file: string; address: string; description: string; tags: string[] }

function PicturePicker({ language, onPick, onClose }: { language: EditorLanguage; onPick: (address: string) => void; onClose: () => void }) {
  const t = (key: TextKey) => uiText(language, key)
  const [pictures, setPictures] = useState<PictureRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(48)
  useEffect(() => {
    void fetch('/api/pictures')
      .then((response) => response.json())
      .then((data: { pictures?: PictureRow[] }) => setPictures(data.pictures ?? []))
      .catch(() => setPictures([]))
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const needle = query.trim().toLowerCase()
  const found = (pictures ?? []).filter((picture) => !needle || `${picture.file} ${picture.description} ${picture.tags.join(' ')}`.toLowerCase().includes(needle))
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal picker" role="dialog" aria-modal="true" aria-label={t('content.pictures')} onClick={(event) => event.stopPropagation()}>
        <h2>{t('content.pictures')}</h2>
        <input type="search" autoFocus value={query} placeholder={t('content.search')} aria-label={t('content.search')} onChange={(event) => setQuery(event.target.value)} />
        <div className="picker-grid">
          {!pictures && <p className="browser-note">{t('content.loading')}</p>}
          {pictures && found.length === 0 && <p className="browser-note">{t('content.nothing')}</p>}
          {found.slice(0, shown).map((picture) => (
            <button type="button" key={picture.file} className="picker-item" title={picture.description || picture.file} onClick={() => onPick(picture.address)}>
              <img src={`/api/pictures/raw?file=${encodeURIComponent(picture.file)}&w=240`} alt="" loading="lazy" decoding="async" />
              <span>{picture.file}</span>
            </button>
          ))}
        </div>
        {found.length > shown && <button type="button" className="quiet-button" onClick={() => setShown((count) => count + 48)}>{uiText(language, 'content.more', { count: found.length - shown })}</button>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>{t('content.close')}</button>
        </div>
      </div>
    </div>
  )
}
