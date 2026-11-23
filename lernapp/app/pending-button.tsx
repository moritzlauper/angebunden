"use client";

import { useFormStatus } from "react-dom";

/** Absende-Knopf, der während der Server-Action gesperrt ist und einen Hinweis zeigt. */
export function PendingButton({
  children,
  pendingText,
  className = "btn",
  title,
}: {
  children: React.ReactNode;
  pendingText: string;
  className?: string;
  title?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      disabled={pending}
      aria-busy={pending}
      title={title}
    >
      {pending ? pendingText : children}
    </button>
  );
}
