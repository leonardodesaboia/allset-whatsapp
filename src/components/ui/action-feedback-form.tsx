"use client";

import { useActionState, type ReactNode } from "react";

type ActionResult = { ok: boolean; error?: string };

interface ActionFeedbackFormProps {
  action: (formData: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
}

/**
 * Keeps server-action failures visible to the operator instead of silently
 * discarding the returned result from a native form submission.
 */
export function ActionFeedbackForm({ action, children, className }: ActionFeedbackFormProps) {
  const [result, formAction] = useActionState<ActionResult | null, FormData>(
    async (_previous, formData) => action(formData),
    null,
  );

  return (
    <form action={formAction} className={className}>
      {children}
      {result && !result.ok && (
        <p role="alert" className="mt-1 text-xs text-red-600">{result.error ?? "Não foi possível concluir a ação."}</p>
      )}
    </form>
  );
}
