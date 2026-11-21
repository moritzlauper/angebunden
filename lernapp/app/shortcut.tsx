'use client'

import { useEffect, useRef } from 'react'

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

const isTextField = (t: Element | null) =>
  !!t &&
  ((t as HTMLElement).isContentEditable ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes((t as HTMLInputElement).type)))

/**
 * Tasten 1–5 (auch Ziffernblock) kreuzen die Antwortoptionen A–E an oder wieder ab.
 * Nicht, solange man in einem Textfeld tippt oder Cmd, Ctrl oder Alt gedrückt hält.
 *
 * Erweiterungen wie Vimium fangen Ziffern auf window ab, bevor die Seite sie sieht, lassen
 * sie aber durch, solange ein Textfeld den Fokus hat. Deshalb hält auf Geräten mit Maus ein
 * unsichtbares, schreibgeschütztes Feld den Fokus und holt ihn sich nach Mausklicks zurück.
 */
export function OptionShortcuts() {
  const sink = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const desktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const grab = () => {
      if (desktop && !isTextField(document.activeElement)) sink.current?.focus({ preventScroll: true })
    }
    grab()
    // Nach Mausklicks (detail > 0) zurückholen, nicht bei Tab-Navigation
    const onClick = (e: MouseEvent) => {
      if (e.detail > 0) setTimeout(grab, 0)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.target === sink.current && e.key === 'Enter' && !(e.metaKey || e.ctrlKey)) {
        e.preventDefault() // Enter im Fokusfeld soll das Formular nicht abschicken
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.isComposing) return
      const n = optionNumber(e)
      if (n === null) return
      if (e.target !== sink.current && isTextField(e.target as Element | null)) return
      const box =
        document.querySelector<HTMLInputElement>(`input[data-option="${n}"]`) ??
        document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="marked"]')[n - 1]
      if (!box) return
      e.preventDefault()
      e.stopPropagation()
      box.click()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    document.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true })
      document.removeEventListener('click', onClick)
    }
  }, [])

  return (
    <input
      ref={sink}
      type="text"
      readOnly
      inputMode="none"
      tabIndex={-1}
      form="__kein-formular"
      aria-label="Tastenkürzel: 1 bis 5 kreuzen die Antworten an"
      style={{ position: 'fixed', top: 0, left: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none', border: 0, padding: 0 }}
    />
  )
}
