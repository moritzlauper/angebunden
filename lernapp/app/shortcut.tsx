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

/**
 * Tasten 1–5 kreuzen die Antwortoptionen A–E an oder wieder ab (Checkboxen mit data-option="1" …).
 * Nicht, solange man in einem Textfeld tippt oder eine Zusatztaste gedrückt hält.
 */
export function OptionShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (!/^[1-5]$/.test(e.key)) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) && (t as HTMLInputElement).type !== 'checkbox') return
      const box = document.querySelector<HTMLInputElement>(`input[data-option="${e.key}"]`)
      if (!box) return
      e.preventDefault()
      box.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return null
}
