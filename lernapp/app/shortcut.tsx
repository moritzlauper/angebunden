'use client'

import { useEffect } from 'react'

/** Cmd+Enter (bzw. Ctrl+Enter) klickt den Hauptknopf der Seite, markiert mit data-shortcut="primary". */
export function PrimaryShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return
      const el = document.querySelector<HTMLElement>('[data-shortcut="primary"]')
      if (!el) return
      e.preventDefault()
      el.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return null
}
