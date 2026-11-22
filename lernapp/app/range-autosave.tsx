'use client'

import { useEffect, useRef } from 'react'

/**
 * Schickt das umgebende Formular mit der übergebenen Server-Action ab, sobald sich eine
 * Auswahl darin ändert. So gilt ein neuer UE-Bereich sofort und nicht erst beim Start.
 */
export function RangeAutoSave({ action }: { action: (fd: FormData) => Promise<void> }) {
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const form = button.current?.form
    if (!form) return
    const onChange = (e: Event) => {
      if (e.target instanceof HTMLSelectElement && button.current) form.requestSubmit(button.current)
    }
    form.addEventListener('change', onChange)
    return () => form.removeEventListener('change', onChange)
  }, [])
  return <button ref={button} formAction={action} hidden tabIndex={-1} aria-hidden />
}
