'use client'

import { useEffect, useRef, useState } from 'react'
import { uiText, type EditorLanguage } from '@/lib/ui-text'

/** Closes on a click outside and on Escape. */
function usePopover() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  return { open, setOpen, rootRef }
}

export function TopBar({
  language,
  siteName,
  changes,
  publishBusy,
  onPublish,
  onRevert,
  onSettings,
  onTips,
  accountName,
  accountPicture,
}: {
  language: EditorLanguage
  siteName: string
  /** How many unpublished changes the draft has, or null while that is not known. */
  changes: number | null
  publishBusy: boolean
  onPublish: () => void
  onRevert: () => void
  onSettings: () => void
  onTips: () => void
  accountName: string
  accountPicture?: string
}) {
  const t = (key: Parameters<typeof uiText>[1], values?: Record<string, string | number>) => uiText(language, key, values)
  const more = usePopover()
  const countText = changes === null ? '' : changes === 0 ? t('bar.noChanges') : changes === 1 ? t('bar.changesOne') : t('bar.changesMany', { count: changes })
  return (
    <header className="topbar">
      <h1 className="site-name">{siteName}</h1>
      <div className="topbar-end">
        <span className="change-count" aria-live="polite">{countText}</span>
        <button className="publish" type="button" disabled={publishBusy} onClick={onPublish}>
          {t('bar.publish')}
          {changes !== null && changes > 0 && <span className="badge">{changes}</span>}
        </button>
        <div className="menu" ref={more.rootRef}>
          <button type="button" className="icon-button" aria-haspopup="menu" aria-expanded={more.open} aria-label={t('bar.more')} title={t('bar.more')} onClick={() => more.setOpen((value) => !value)}>
            ⋯
          </button>
          {more.open && (
            <div className="menu-list" role="menu">
              <button type="button" role="menuitem" onClick={() => { more.setOpen(false); onTips() }}>{t('tips.button')}</button>
              <button type="button" role="menuitem" onClick={() => { more.setOpen(false); onSettings() }}>{t('bar.settings')}</button>
              <button type="button" role="menuitem" className="danger" onClick={() => { more.setOpen(false); onRevert() }}>{t('bar.revert')}</button>
            </div>
          )}
        </div>
        <AccountMenu language={language} name={accountName} picture={accountPicture} />
      </div>
    </header>
  )
}

function AccountMenu({ language, name, picture }: { language: EditorLanguage; name: string; picture?: string }) {
  const account = usePopover()
  const [broken, setBroken] = useState(false)
  const initial = name.trim().charAt(0).toUpperCase() || 'E'
  return (
    <div className="menu account" ref={account.rootRef}>
      <button type="button" className="avatar" aria-expanded={account.open} aria-haspopup="menu" aria-label={uiText(language, 'bar.account')} onClick={() => account.setOpen((value) => !value)}>
        {picture && !broken ? <img src={picture} alt="" onError={() => setBroken(true)} /> : <span>{initial}</span>}
      </button>
      {account.open && (
        <div className="menu-list" role="menu">
          <p className="menu-name">{name}</p>
          <a role="menuitem" href="/auth/logout">{uiText(language, 'bar.logout')}</a>
        </div>
      )}
    </div>
  )
}
