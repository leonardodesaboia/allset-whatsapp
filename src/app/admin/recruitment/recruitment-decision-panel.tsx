"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RecruitmentStatus } from "@/domain/recruitment/recruitment-status";
import { recruitmentColumn } from "@/domain/recruitment/recruitment-pipeline";
import { recruitmentDecisionAction } from "./actions";
import { Button } from "@/components/ui/button";

type Decision =
  "ANALYZE" | "REQUEST_DOCUMENT" | "APPROVE" | "REJECT" | "FUTURE" | "CONTACT";
export function RecruitmentDecisionPanel({
  leadId,
  status,
  version,
  phone,
}: {
  leadId: string;
  status: RecruitmentStatus;
  version: number;
  phone: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const router = useRouter();
  const column = recruitmentColumn(status);
  const actionable = ["TRIAGEM", "CONVERSA_PENDENTE", "DOCUMENTACAO"].includes(
    column
  );
  async function decide(action: Decision) {
    setPending(true);
    setFeedback(null);
    try {
      const result = await recruitmentDecisionAction({
        leadId,
        expectedVersion: version,
        action,
        ...(reason.trim() ? { reason } : {}),
      });
      if (!result.ok) {
        setFeedback(result.error ?? "Não foi possível decidir.");
        return;
      }
      setFeedback(
        phone
          ? "Ação registrada. O aviso foi colocado na fila de envio pelo WhatsApp."
          : "Ação registrada. Cadastre um telefone para avisar a profissional."
      );
      setSelected(null);
      setReason("");
      router.refresh();
    } catch {
      setFeedback("Não foi possível concluir. Tente novamente.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3"
      aria-label="Próxima ação do cadastro"
    >
      <h2 className="text-sm font-semibold">Próxima ação</h2>
      <p className="text-sm">
        Confira as respostas e os documentos antes de aprovar. As decisões
        avisam a profissional pelo WhatsApp.
      </p>
      <div className="flex flex-wrap gap-2">
        {["TRIAGEM", "BASE_FUTURA"].includes(column) && (
          <Button disabled={pending} onClick={() => void decide("ANALYZE")}>
            Analisar cadastro
          </Button>
        )}
        {actionable && (
          <>
            {column !== "TRIAGEM" && (
              <Button
                disabled={pending}
                variant="outline"
                onClick={() => {
                  setSelected("REQUEST_DOCUMENT");
                  setReason("");
                }}
              >
                Pedir documento
              </Button>
            )}
            {column === "DOCUMENTACAO" && (
              <Button
                disabled={pending}
                variant="success"
                onClick={() => setSelected("APPROVE")}
              >
                Aprovar
              </Button>
            )}
            <Button
              disabled={pending}
              variant="destructive"
              onClick={() => {
                setSelected("REJECT");
                setReason("");
              }}
            >
              Reprovar com motivo
            </Button>
            <Button
              disabled={pending}
              variant="outline"
              onClick={() => {
                setSelected("FUTURE");
                setReason("");
              }}
            >
              Base futura
            </Button>
          </>
        )}
        {phone && (
          <Button
            disabled={pending}
            variant="outline"
            onClick={() => void decide("CONTACT")}
          >
            Falar com ela
          </Button>
        )}
      </div>
      {selected && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void decide(selected);
          }}
        >
          {selected === "APPROVE" ? (
            <p>
              Confirmar aprovação? Todos os documentos obrigatórios precisam
              estar aprovados e os termos ativos aceitos.
            </p>
          ) : (
            <label className="block text-sm">
              {selected === "REQUEST_DOCUMENT"
                ? "Documento ou ajuste necessário"
                : "Motivo da decisão"}
              <textarea
                required
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="block w-full rounded border p-2 mt-1"
              />
            </label>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              Confirmar decisão
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setSelected(null)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
      {feedback && (
        <p role="status" className="text-sm">
          {feedback}
        </p>
      )}
      {phone && (
        <a
          className="text-sm text-blue-700 underline inline-block"
          href={`https://wa.me/${phone.replace(/\D/g, "")}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Abrir conversa no WhatsApp
        </a>
      )}
    </section>
  );
}
