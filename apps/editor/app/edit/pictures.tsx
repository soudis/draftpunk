'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'

type PictureRecord = {
  file: string
  address: string
  description: string
  tags: string[]
  usages: number
}

type Draft = {
  file: string
  name: string
  description: string
  tagText: string
  usages: number
  insert: boolean
}

export function PictureDesk({
  draftRef,
  onLock,
}: {
  draftRef: RefObject<HTMLTextAreaElement | null>
  onLock: (locked: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const insertOnSave = useRef(true)
  const draftState = useRef<Draft | null>(null)
  const queueRef = useRef<Draft[]>([])
  const managerRef = useRef(false)
  const uploadRef = useRef<(files: File[], insert: boolean) => Promise<void>>(async () => {})
  const [mounted, setMounted] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [manager, setManager] = useState(false)
  const [pictures, setPictures] = useState<PictureRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(60)
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => setMounted(true), [])
  useEffect(() => onLock(draft !== null || manager), [draft, manager, onLock])
  managerRef.current = manager

  useEffect(() => {
    const field = draftRef.current
    if (!field) return
    const onPaste = (event: ClipboardEvent) => {
      const files = imageFiles(event.clipboardData?.files, event.clipboardData?.items)
      if (files.length === 0) return
      event.preventDefault()
      void uploadRef.current(files, true)
    }
    const onDrop = (event: DragEvent) => {
      const files = imageFiles(event.dataTransfer?.files, null)
      if (files.length === 0) return
      event.preventDefault()
      void uploadRef.current(files, true)
    }
    const onDragOver = (event: DragEvent) => {
      if ([...(event.dataTransfer?.items ?? [])].some((item) => item.kind === 'file')) event.preventDefault()
    }
    field.addEventListener('paste', onPaste)
    field.addEventListener('drop', onDrop)
    field.addEventListener('dragover', onDragOver)
    return () => {
      field.removeEventListener('paste', onPaste)
      field.removeEventListener('drop', onDrop)
      field.removeEventListener('dragover', onDragOver)
    }
  }, [draftRef])

  async function reload() {
    const response = await fetch('/api/pictures')
    if (!response.ok) return
    const data = (await response.json()) as { pictures?: PictureRecord[] }
    setPictures(data.pictures ?? [])
    setLoaded(true)
  }

  async function upload(files: File[], insert: boolean) {
    setError('')
    setBusy(true)
    const saved: Draft[] = []
    for (const file of files) {
      const body = new FormData()
      body.set('file', file)
      const response = await fetch('/api/pictures', { method: 'POST', body })
      const data = (await response.json()) as PictureRecord & { error?: string }
      if (!response.ok) {
        setError(data.error || 'Could not save that picture.')
        continue
      }
      saved.push(toDraft(data, insert))
    }
    setBusy(false)
    if (saved.length > 0) {
      enqueue(saved)
      if (managerRef.current) void reload()
    }
  }
  uploadRef.current = upload

  function enqueue(saved: Draft[]) {
    if (!draftState.current) {
      const [first, ...rest] = saved
      draftState.current = first ?? null
      queueRef.current = [...queueRef.current, ...rest]
      setDraft(first ?? null)
    } else {
      queueRef.current = [...queueRef.current, ...saved]
    }
  }

  function closeDraft() {
    const [next, ...rest] = queueRef.current
    queueRef.current = rest
    draftState.current = next ?? null
    setDraft(next ?? null)
  }

  async function keep() {
    if (!draft || !draft.name.trim() || busy) return
    setBusy(true)
    setError('')
    const response = await fetch('/api/pictures', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: draft.file,
        name: draft.name,
        description: draft.description,
        tags: draft.tagText.split(',').map((tag) => tag.trim()).filter(Boolean),
      }),
    })
    const data = (await response.json()) as PictureRecord & { error?: string }
    setBusy(false)
    if (!response.ok) {
      setError(data.error || 'Could not update that picture.')
      return
    }
    if (draft.insert) insertAddresses(draftRef.current, [data.address])
    if (manager) void reload()
    closeDraft()
  }

  async function discard() {
    if (!draft || busy) return
    setBusy(true)
    setError('')
    const response = await fetch('/api/pictures', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: draft.file }),
    })
    const data = (await response.json()) as { error?: string }
    setBusy(false)
    if (!response.ok) {
      setError(data.error || 'Could not discard that picture.')
      return
    }
    if (manager) void reload()
    closeDraft()
  }

  async function generate() {
    if (!draft || busy) return
    setBusy(true)
    setError('')
    const response = await fetch('/api/pictures/suggest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: draft.file }),
    })
    const data = (await response.json()) as { name?: string; description?: string; tags?: string[]; error?: string }
    setBusy(false)
    if (!response.ok) {
      setError(data.error || 'Could not look at that picture.')
      return
    }
    setDraft({
      ...draft,
      name: data.name || draft.name,
      description: data.description ?? draft.description,
      tagText: data.tags?.length ? data.tags.join(', ') : draft.tagText,
    })
  }

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const filtered = words.length
    ? pictures.filter((picture) => {
        const haystack = `${picture.file} ${picture.description} ${picture.tags.join(' ')}`.toLowerCase()
        return words.every((word) => haystack.includes(word))
      })
    : pictures
  const visible = filtered.slice(0, shown)

  const dialogs = mounted
    ? createPortal(
        <>
          {manager && (
            <div className="modal-back manager" role="presentation">
              <div className="modal library" role="dialog" aria-modal="true" aria-label="Pictures">
                <div className="library-head">
                  <div className="modal-bar">
                    <h2>Pictures</h2>
                    <button type="button" className="quiet" onClick={() => setManager(false)}>
                      Close
                    </button>
                  </div>
                  <div className="picture-actions">
                    <input
                      aria-label="Search pictures"
                      placeholder="Search name, description, or tag"
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value)
                        setShown(60)
                      }}
                    />
                    <button type="button" onClick={() => choose(false)}>
                      Upload
                    </button>
                    <button type="button" disabled={selected.length === 0} onClick={() => insertSelected()}>
                      Insert {selected.length || ''}
                    </button>
                  </div>
                  {error && !draft && <p className="picture-error">{error}</p>}
                </div>
                <div className="picture-scroll">
                  <div className="picture-grid">
                    {visible.map((picture) => (
                      <article key={picture.file}>
                        <label>
                          <input
                            type="checkbox"
                            aria-label={picture.address}
                            checked={selected.includes(picture.file)}
                            onChange={() =>
                              setSelected((current) =>
                                current.includes(picture.file) ? current.filter((file) => file !== picture.file) : [...current, picture.file],
                              )
                            }
                          />
                          <img src={`/api/pictures/raw?file=${encodeURIComponent(picture.file)}`} alt="" />
                        </label>
                        <button type="button" className="quiet" onClick={() => setDraft(toDraft(picture, false))}>
                          {stemOf(picture.file)}
                        </button>
                      </article>
                    ))}
                  </div>
                  {filtered.length > shown && (
                    <button type="button" onClick={() => setShown((count) => count + 60)}>
                      Show more
                    </button>
                  )}
                </div>
                <p className="picture-note library-count">
                  {loaded ? `${filtered.length} ${filtered.length === 1 ? 'picture' : 'pictures'}` : 'Loading pictures…'}
                </p>
              </div>
            </div>
          )}
          {draft && (
            <div className="modal-back" role="presentation">
              <div className="modal picture-editor" role="dialog" aria-modal="true" aria-label="Picture">
                <div className="modal-bar">
                  <h2>Picture</h2>
                  <button type="button" className="quiet" onClick={() => { setError(''); closeDraft() }}>
                    Close
                  </button>
                </div>
                <div className="picture-editor-body">
                <img src={`/api/pictures/raw?file=${encodeURIComponent(draft.file)}`} alt="" />
                <label>
                  Name
                  <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                </label>
                <p className="picture-note">{previewAddress(draft.file, draft.name)}</p>
                <label>
                  Tags
                  <input
                    value={draft.tagText}
                    placeholder="hof, garten"
                    onChange={(event) => setDraft({ ...draft, tagText: event.target.value })}
                  />
                </label>
                <label>
                  Description
                  <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
                </label>
                <p className={draft.usages > 0 ? 'picture-used' : 'picture-note'}>
                  {draft.usages === 0 ? 'Not used in content yet.' : `Used ${draft.usages} ${draft.usages === 1 ? 'time' : 'times'} in content.`}
                </p>
                {draft.name.trim() && draft.name.trim() !== stemOf(draft.file) && draft.usages > 0 && (
                  <p className="picture-note">Renaming leaves those pages pointing at the old address.</p>
                )}
                {error && <p className="picture-error">{error}</p>}
                <div className="picture-actions">
                  <button type="button" disabled={busy} onClick={() => void generate()}>
                    {busy ? 'Working…' : 'Generate'}
                  </button>
                  <button type="button" className="quiet" disabled={busy} onClick={() => void discard()}>
                    Discard
                  </button>
                  <button type="button" disabled={busy || !draft.name.trim()} onClick={() => void keep()}>
                    Keep
                  </button>
                </div>
                </div>
              </div>
            </div>
          )}
        </>,
        document.body,
      )
    : null

  function choose(insert: boolean) {
    insertOnSave.current = insert
    inputRef.current?.click()
  }

  function insertSelected() {
    const addresses = pictures.filter((picture) => selected.includes(picture.file)).map((picture) => picture.address)
    insertAddresses(draftRef.current, addresses)
    setSelected([])
    setManager(false)
  }

  return (
    <>
      <div className="picture-actions">
        <button
          type="button"
          onClick={() => {
            setError('')
            setManager(true)
            setShown(60)
            void reload()
          }}
        >
          Pictures
        </button>
        <button type="button" disabled={busy} onClick={() => choose(true)}>
          Upload
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,.svg"
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ''
            if (files.length) void upload(files, insertOnSave.current)
          }}
        />
      </div>
      {error && !draft && !manager && <p className="picture-error">{error}</p>}
      {dialogs}
    </>
  )
}

function toDraft(picture: PictureRecord, insert: boolean): Draft {
  return {
    file: picture.file,
    name: stemOf(picture.file),
    description: picture.description,
    tagText: picture.tags.join(', '),
    usages: picture.usages,
    insert,
  }
}

function stemOf(file: string): string {
  const base = file.split('/').pop() ?? file
  return base.replace(/\.[^.]+$/, '')
}

function previewAddress(file: string, name: string): string {
  const slash = file.lastIndexOf('/')
  const dir = slash >= 0 ? file.slice(0, slash + 1) : ''
  const ext = file.split('.').pop() || 'jpg'
  return `/media/${dir}${name.trim() || stemOf(file)}.${ext}`
}

function insertAddresses(field: HTMLTextAreaElement | null, addresses: string[]) {
  if (!field || addresses.length === 0) return
  const chunk = addresses.join(' ')
  const start = field.selectionStart ?? field.value.length
  const end = field.selectionEnd ?? field.value.length
  const before = field.value.slice(0, start)
  const pad = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
  field.value = before + pad + chunk + field.value.slice(end)
  const cursor = before.length + pad.length + chunk.length
  field.setSelectionRange(cursor, cursor)
  field.focus()
}

function imageFiles(files: FileList | undefined | null, items: DataTransferItemList | undefined | null): File[] {
  const fromItems = [...(items ?? [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
  if (fromItems.length > 0) return fromItems
  return [...(files ?? [])].filter((file) => file.type.startsWith('image/') || /\.svg$/i.test(file.name))
}
