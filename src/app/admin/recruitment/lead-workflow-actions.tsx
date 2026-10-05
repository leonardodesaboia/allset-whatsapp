"use client";

import { useState } from "react";
import type { InterviewResult, ReferenceStatus } from "@prisma/client";
import type { RecruitmentStatus } from "@/domain/recruitment/recruitment-status";
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
  status,
  openInterviewId,
  latestReferenceId,
}: {
  leadId: string;
  status: RecruitmentStatus;
  openInterviewId?: string;
  latestReferenceId?: string;
}) {
  const [referenceName, setReferenceName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const execute = async (action: () => Promise<{ ok: boolean; error?: string }>, successMessage?: string) => {
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await action();
      if (result.ok) {
        if (successMessage) {
          setSuccess(successMessage);
          setTimeout(() => setSuccess(null), 3000);
        }
      } else {
        setError(result.error ?? "Não foi possível concluir a ação.");
      }
    } catch {
      setError("Não foi possível concluir a ação. Tente novamente.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
        <ClipboardList className="w-4 h-4 text-slate-400" />
        Ações de recrutamento
      </h2>

      <div className="flex flex-wrap gap-2">
        {status === "CONVERSA_PENDENTE" && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => void execute(() => startInterviewAction(leadId), "Entrevista iniciada.")}
          >
            <PlayCircle className="w-3.5 h-3.5 mr-1.5" />
            Iniciar entrevista
          </Button>
        )}

        {status === "ENTREVISTA" && openInterviewId && (
          <>
            <Button type="button" variant="success" size="sm" disabled={pending} onClick={() => void execute(() => completeInterviewAction({ interviewId: openInterviewId, result: "REFERENCIA" as InterviewResult }), "Avançado para referências.")}>
              <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
              Seguir para referências
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void execute(() => completeInterviewAction({ interviewId: openInterviewId, result: "AGUARDANDO_COMPLEMENTACAO" as InterviewResult }), "Complementação solicitada.")}>
              Pedir complementação
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void execute(() => completeInterviewAction({ interviewId: openInterviewId, result: "BASE_FUTURA" as InterviewResult }), "Movida para base futura.")}>
              Mover para base futura
            </Button>
            <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => void execute(() => completeInterviewAction({ interviewId: openInterviewId, result: "REPROVADA" as InterviewResult }), "Reprovada.")}>
              Reprovar
            </Button>
          </>
        )}

        {status === "REFERENCIA" && latestReferenceId && (
          <Button
            type="button"
            variant="success"
            size="sm"
            disabled={pending}
            onClick={() => void execute(
              () => verifyReferenceAction({ referenceId: latestReferenceId, leadId, status: "CONFIRMED" as ReferenceStatus }),
              "Referência confirmada.",
            )}
          >
            <UserCheck className="w-3.5 h-3.5 mr-1.5" />
            Confirmar referência
          </Button>
        )}
      </div>

      {status === "REFERENCIA" && (
      <form
        action={() => void execute(async () => {
          const result = await addReferenceAction({ leadId, name: referenceName });
          if (result.ok) setReferenceName("");
          return result;
        }, "Referência adicionada.")}
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
      )}

      <form
        action={() => void execute(async () => {
          const result = await addAssessmentAction({ leadId, ...(notes.trim() ? { notes } : {}) });
          if (result.ok) setNotes("");
          return result;
        }, "Avaliação registrada.")}
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
      {success && (
        <p role="status" className="text-sm text-emerald-600">
          {success}
        </p>
      )}
    </section>
  );
}
