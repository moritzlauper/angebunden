'use client'

import { useEffect, useState } from 'react'

type Choice = 'auto' | 'light' | 'dark'
const ORDER: Choice[] = ['auto', 'light', 'dark']
const LABEL: Record<Choice, string> = { auto: 'Auto', light: 'Hell', dark: 'Dunkel' }

/**
 * Setzt data-theme auf <html>, bevor die Seite gezeichnet wird. Läuft als Inline-Skript im <head>,
 * damit beim Laden nichts aufblitzt. «auto» folgt der Systemeinstellung und reagiert auf deren Wechsel.
 */
export const themeScript = `(function(){
var d=document.documentElement,m=matchMedia('(prefers-color-scheme: dark)');
function a(){var c='auto';try{c=localStorage.getItem('theme')||'auto'}catch(e){}
var dark=c==='dark'||(c==='auto'&&m.matches);d.dataset.theme=dark?'dark':'light';d.dataset.themeChoice=c;
var t=document.querySelector('meta[name="theme-color"]');if(!t){t=document.createElement('meta');t.name='theme-color';document.head.appendChild(t)}
t.content=dark?'#1f1b28':'#dcd7e6'}
a();m.addEventListener('change',a);window.__applyTheme=a})()`

declare global {
  interface Window {
    __applyTheme?: () => void
  }
}

/** Knopf in der Kopfzeile: wechselt reihum Auto → Hell → Dunkel und merkt sich die Wahl im Browser. */
export function ThemeSwitch() {
  const [choice, setChoice] = useState<Choice>('auto')
  useEffect(() => {
    setChoice((document.documentElement.dataset.themeChoice as Choice) ?? 'auto')
  }, [])
  const next = () => {
    const c = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]
    try {
      if (c === 'auto') localStorage.removeItem('theme')
      else localStorage.setItem('theme', c)
    } catch {}
    window.__applyTheme?.()
    setChoice(c)
  }
  return (
    <button type="button" onClick={next} className="theme-switch" title="Darstellung: Auto folgt der Systemeinstellung">
      {LABEL[choice]}
    </button>
  )
}
