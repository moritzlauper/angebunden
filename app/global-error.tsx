'use client'

import { useEffect } from 'react'

const SCHLUESSEL = 'angebunden-letzter-fehler'

/**
 * Ersetzt die englische Standardseite «This page couldn't load», die Next.js zeigt, wenn im Browser
 * eine Ausnahme nicht abgefangen wird. Zeigt den Fehler an, schreibt ihn ins Log (in der Android-App
 * via `adb logcat` sichtbar) und merkt ihn sich, damit sich die Ursache finden lässt.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const text = [
    `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`,
    error?.digest ? `digest ${error.digest}` : '',
    (error?.stack ?? '').split('\n').slice(0, 8).join('\n'),
    typeof location !== 'undefined' ? location.href : '',
  ]
    .filter(Boolean)
    .join('\n')

  useEffect(() => {
    console.error(`[seitenfehler] ${text}`)
    try {
      localStorage.setItem(SCHLUESSEL, JSON.stringify({ text, zeit: new Date().toISOString() }))
    } catch {}
  }, [text])

  return (
    <html lang="de-CH">
      <body style={{ margin: 0, padding: '24px 16px', font: '16px system-ui, sans-serif', background: '#fff', color: '#111' }}>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Die Seite konnte nicht angezeigt werden</h1>
        <p style={{ margin: '0 0 16px' }}>Beim Anzeigen ist ein Fehler aufgetreten. Neu laden hilft meistens.</p>
        <button
          type="button"
          onClick={() => location.reload()}
          style={{ font: 'inherit', padding: '10px 18px', borderRadius: 8, border: 0, background: '#111', color: '#fff' }}
        >
          Neu laden
        </button>
        <pre style={{ marginTop: 24, padding: 12, background: '#f3f3f3', borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</pre>
      </body>
    </html>
  )
}
