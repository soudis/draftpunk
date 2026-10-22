'use client'

import { useCallback, useEffect, useState } from 'react'
import { parseEditorLanguage, type EditorLanguage } from '@/lib/ui-text'

const KEY = 'schlor-editor-language'
const EVENT = 'schlor-editor-language'

function stored(): EditorLanguage {
  try {
    return parseEditorLanguage(localStorage.getItem(KEY))
  } catch {
    return 'de'
  }
}

/** The language of the editor for this person: German until they choose English. */
export function useEditorLanguage(): [EditorLanguage, (language: EditorLanguage) => void] {
  const [language, setLanguage] = useState<EditorLanguage>('de')
  useEffect(() => {
    setLanguage(stored())
    const sync = () => setLanguage(stored())
    window.addEventListener(EVENT, sync)
    return () => window.removeEventListener(EVENT, sync)
  }, [])
  const choose = useCallback((next: EditorLanguage) => {
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // A browser that keeps nothing keeps the language for this page only.
    }
    setLanguage(next)
    window.dispatchEvent(new Event(EVENT))
  }, [])
  return [language, choose]
}
