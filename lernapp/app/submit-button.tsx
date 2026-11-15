'use client'

import { useFormStatus } from 'react-dom'

/** Knopf, der während der Server Action anzeigt, dass gearbeitet wird. */
export function SubmitButton({ children, pending, quiet }: { children: React.ReactNode; pending: string; quiet?: boolean }) {
  const { pending: busy } = useFormStatus()
  return (
    <button className={quiet ? 'btn-quiet' : 'btn'} disabled={busy} aria-busy={busy}>
      {busy ? pending : children}
    </button>
  )
}
