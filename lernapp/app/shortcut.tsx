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

/** Physische Taste → Option 1–5. e.code statt e.key, damit es bei jeder Tastaturbelegung geht (z. B. AZERTY). */
function optionNumber(e: KeyboardEvent): number | null {
  const m = /^(?:Digit|Numpad)([1-5])$/.exec(e.code) ?? /^([1-5])$/.exec(e.key)
  return m ? Number(m[1]) : null
}

/**
 * Tasten 1–5 (auch Ziffernblock) kreuzen die Antwortoptionen A–E an oder wieder ab.
 * Nicht, solange man in einem Textfeld tippt oder Cmd, Ctrl oder Alt gedrückt hält.
 * Hört in der Capture-Phase, damit andere Handler die Taste nicht vorher abfangen.
 */
export function OptionShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.isComposing) return
      const n = optionNumber(e)
      if (n === null) return
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox'))
      if (typing) return
      const box =
        document.querySelector<HTMLInputElement>(`input[data-option="${n}"]`) ??
        document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="marked"]')[n - 1]
      if (!box) return
      e.preventDefault()
      e.stopPropagation()
      box.click()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])
  return null
}
