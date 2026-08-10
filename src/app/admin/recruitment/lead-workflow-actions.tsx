"use client";

import { useState } from "react";
import type { InterviewResult, ReferenceStatus } from "@prisma/client";
import { PlayCircle, CheckCircle, UserCheck, ClipboardList, AlertCircle } from "lucide-react";
import {
  addAssessmentAction,
  addReferenceAction,
  completeInterviewAction,
  startInterviewAction,
  verifyReferenceAction,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LeadWorkflowActions({
  leadId,
  openInterviewId,
  latestReferenceId,
}: {
  leadId: string;
  openInterviewId?: string;
  latestReferenceId?: string;
}) {
  const [referenceName, setReferenceName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const execute = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setPending(true);
    const result = await action();
    setPending(false);
    setError(result.ok ? null : (result.error ?? "Não foi possível concluir a ação."));
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
        <ClipboardList className="w-4 h-4 text-slate-400" />
        Ações de recrutamento
      </h2>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => void execute(() => startInterviewAction(leadId))}
        >
          <PlayCircle className="w-3.5 h-3.5 mr-1.5" />
          Iniciar entrevista
        </Button>

        {openInterviewId && (
          <Button
            type="button"
            variant="success"
            size="sm"
            disabled={pending}
            onClick={() => void execute(() =>
              completeInterviewAction({ interviewId: openInterviewId, result: "REFERENCIA" as InterviewResult })
            )}
          >
            <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
            Concluir entrevista
          </Button>
        )}

        {latestReferenceId && (
          <Button
            type="button"
            variant="success"
            size="sm"
            disabled={pending}
            onClick={() => void execute(() =>
              verifyReferenceAction({ referenceId: latestReferenceId, leadId, status: "CONFIRMED" as ReferenceStatus })
            )}
          >
            <UserCheck className="w-3.5 h-3.5 mr-1.5" />
            Confirmar referência
          </Button>
        )}
      </div>

      <form
        action={() => void execute(async () => {
          const result = await addReferenceAction({ leadId, name: referenceName });
          if (result.ok) setReferenceName("");
          return result;
        })}
        className="flex items-center gap-2"
      >
        <Input
          value={referenceName}
          onChange={(e) => setReferenceName(e.target.value)}
          placeholder="Nome da referência"
          required
          className="max-w-xs"
          aria-label="Nome da referência"
        />
        <Button type="submit" variant="outline" size="sm" disabled={pending || !referenceName.trim()}>
          Adicionar referência
        </Button>
      </form>

      <form
        action={() => void execute(() => addAssessmentAction({ leadId, ...(notes.trim() ? { notes } : {}) }))}
        className="flex items-start gap-2"
      >
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Nota de avaliação (opcional)"
          aria-label="Nota de avaliação"
          rows={2}
          className="flex-1 max-w-xs resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <Button type="submit" variant="outline" size="sm" disabled={pending} className="mt-0.5">
          Registrar avaliação
        </Button>
      </form>

      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-red-600">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </p>
      )}
    </section>
  );
}
