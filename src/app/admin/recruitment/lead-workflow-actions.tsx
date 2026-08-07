"use client";

import { useState } from "react";
import type { InterviewResult, ReferenceStatus } from "@prisma/client";
import {
  addAssessmentAction,
  addReferenceAction,
  completeInterviewAction,
  startInterviewAction,
  verifyReferenceAction,
} from "./actions";

export function LeadWorkflowActions({ leadId, openInterviewId, latestReferenceId }: { leadId: string; openInterviewId?: string; latestReferenceId?: string }) {
  const [referenceName, setReferenceName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const execute = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    const result = await action();
    setError(result.ok ? null : (result.error ?? "Não foi possível concluir a ação."));
  };
  return <section><h2>Ações de recrutamento</h2><button type="button" onClick={() => void execute(() => startInterviewAction(leadId))}>Iniciar entrevista</button>{openInterviewId && <button type="button" onClick={() => void execute(() => completeInterviewAction({ interviewId: openInterviewId, result: "REFERENCIA" as InterviewResult }))}>Concluir entrevista</button>}<form action={() => void execute(async () => { const result = await addReferenceAction({ leadId, name: referenceName }); if (result.ok) setReferenceName(""); return result; })}><label>Nome da referência<input value={referenceName} onChange={(event) => setReferenceName(event.target.value)} required /></label><button type="submit">Adicionar referência</button></form>{latestReferenceId && <button type="button" onClick={() => void execute(() => verifyReferenceAction({ referenceId: latestReferenceId, leadId, status: "CONFIRMED" as ReferenceStatus }))}>Confirmar referência</button>}<form action={() => void execute(() => addAssessmentAction({ leadId, ...(notes.trim() ? { notes } : {}) }))}><label>Nota de avaliação<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label><button type="submit">Registrar avaliação</button></form>{error && <p role="alert">{error}</p>}</section>;
}
