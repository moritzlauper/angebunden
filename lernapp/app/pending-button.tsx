'use client'

import { useFormStatus } from 'react-dom'

/** Absende-Knopf, der während der Server-Action gesperrt ist und einen Hinweis zeigt. */
export function PendingButton({ children, pendingText }: { children: React.ReactNode; pendingText: string }) {
  const { pending } = useFormStatus()
  return (
    <button className="btn" disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  )
}
