'use client'

import { useEffect, useState, type KeyboardEvent } from 'react'
import {
  addressSuggestions,
  modelAfterProviderPick,
  modelSuggestions,
  providerForBase,
  type ModelChoice,
} from '@/lib/model-catalog'
import { uiText, EDITOR_LANGUAGES, parseEditorLanguage, type EditorLanguage, type TextKey } from '@/lib/ui-text'

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

type ImageView = {
  provider: string
  baseURL: string
  model: string
  keySet: boolean
  providers: { kind: string; name: string; baseURL: string; modelHint: string }[]
}

export function SettingsDrawer({
  siteName,
  language,
  onLanguage,
  needToken,
  onClose,
  onSaved,
}: {
  siteName: string
  language: EditorLanguage
  onLanguage: (language: EditorLanguage) => void
  /** No token is saved yet, so the editor cannot change anything. */
  needToken: boolean
  onClose: () => void
  onSaved: (saved: { siteName: string; tokenSet: boolean }) => void
}) {
  const t = (key: TextKey) => uiText(language, key)
  const [name, setName] = useState(siteName)
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [contentModel, setContentModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [tokenSet, setTokenSet] = useState(false)
  const [images, setImages] = useState<ImageView>({ provider: '', baseURL: '', model: '', keySet: false, providers: [] })
  const [imageKey, setImageKey] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void fetch('/api/settings')
      .then((response) => response.json())
      .then((data: { baseURL?: string; model?: string; contentModel?: string; siteName?: string; tokenSet?: boolean; error?: string }) => {
        if (data.error) {
          setError(data.error)
          return
        }
        setBaseURL(data.baseURL ?? '')
        setModel(data.model ?? '')
        setContentModel(data.contentModel ?? '')
        setTokenSet(data.tokenSet === true)
        if (data.siteName) setName(data.siteName)
      })
      .catch(() => setError(t('settings.loadFailed')))
  }, [])

  useEffect(() => {
    void fetch('/api/image-settings')
      .then((response) => response.json())
      .then((data: ImageView & { error?: string }) => {
        if (!data.error) setImages({ provider: data.provider ?? '', baseURL: data.baseURL ?? '', model: data.model ?? '', keySet: data.keySet === true, providers: data.providers ?? [] })
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [onClose])

  async function save() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteName: name, baseURL, model, apiKey, contentModel }),
      })
      const data = (await response.json()) as { error?: string; siteName?: string; tokenSet?: boolean }
      if (!response.ok || data.error || !data.siteName) {
        setError(data.error ?? t('settings.saveFailed'))
        return
      }
      const imageResponse = await fetch('/api/image-settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: images.provider, baseURL: images.baseURL, model: images.model, apiKey: imageKey }),
      })
      const imageData = (await imageResponse.json()) as { error?: string }
      if (!imageResponse.ok || imageData.error) {
        setError(imageData.error ?? t('settings.saveFailed'))
        return
      }
      onSaved({ siteName: data.siteName, tokenSet: data.tokenSet === true })
    } catch {
      setError(t('settings.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="drawer-back" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={t('settings.title')} onClick={(event) => event.stopPropagation()}>
        <header className="drawer-head">
          <h2>{t('settings.title')}</h2>
          <button type="button" className="icon-button small" aria-label={t('settings.close')} title={t('settings.close')} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="drawer-body">
          {needToken && <p className="gaps">{t('settings.needToken')}</p>}
          <section className="drawer-section">
            <h3>{t('settings.site')}</h3>
            <label>
              {t('settings.siteName')}
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
          </section>
          <section className="drawer-section">
            <h3>{t('settings.editor')}</h3>
            <label>
              {t('language.label')}
              <select value={language} onChange={(event) => onLanguage(parseEditorLanguage(event.target.value))}>
                {EDITOR_LANGUAGES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section className="drawer-section">
            <h3>{t('settings.model')}</h3>
            <p className="drawer-help">{t('settings.modelHelp')}</p>
            <SuggestField
              label={t('settings.address')}
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
              label={t('settings.modelName')}
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
            <SuggestField
              label={t('settings.contentModel')}
              value={contentModel}
              onValue={setContentModel}
              options={modelOptions(contentModel, baseURL)}
              onPick={(id) => {
                const choice = choiceById(modelSuggestions(contentModel, baseURL), id)
                if (choice) setContentModel(choice.model)
              }}
            />
            <label>
              {t('settings.token')}
              <input
                type="password"
                value={apiKey}
                autoComplete="off"
                placeholder={tokenSet ? t('settings.tokenKeep') : t('settings.tokenEnter')}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
          </section>
          <section className="drawer-section">
            <h3>{t('settings.images')}</h3>
            <p className="drawer-help">{t('settings.imagesHelp')}</p>
            <label>
              {t('settings.imageService')}
              <select
                value={images.provider}
                onChange={(event) => {
                  const provider = images.providers.find((item) => item.kind === event.target.value)
                  setImages({ ...images, provider: event.target.value, baseURL: provider?.baseURL ?? '' })
                }}
              >
                <option value="">{t('settings.imageNone')}</option>
                {images.providers.map((item) => (
                  <option key={item.kind} value={item.kind}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {images.provider && (
              <>
                <label>
                  {t('settings.imageAddress')}
                  <input value={images.baseURL} onChange={(event) => setImages({ ...images, baseURL: event.target.value })} />
                </label>
                <label>
                  {t('settings.imageModel')}
                  <input
                    value={images.model}
                    placeholder={images.providers.find((item) => item.kind === images.provider)?.modelHint ?? ''}
                    onChange={(event) => setImages({ ...images, model: event.target.value })}
                  />
                </label>
                <label>
                  {t('settings.token')}
                  <input
                    type="password"
                    value={imageKey}
                    autoComplete="off"
                    placeholder={images.keySet ? t('settings.tokenKeep') : t('settings.tokenEnter')}
                    onChange={(event) => setImageKey(event.target.value)}
                  />
                </label>
                {images.provider === 'runware' && <p className="drawer-help">{t('settings.imageKeyShared')}</p>}
              </>
            )}
          </section>
          {error && <p className="picture-error" role="alert">{error}</p>}
        </div>
        <footer className="drawer-foot">
          <button type="button" onClick={onClose}>{t('modal.cancel')}</button>
          <button className="primary" type="button" disabled={busy} onClick={() => void save()}>
            {t('settings.save')}
          </button>
        </footer>
      </aside>
    </div>
  )
}
