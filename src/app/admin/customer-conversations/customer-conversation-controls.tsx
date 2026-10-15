"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CUSTOMER_ADMIN_STEPS } from "@/domain/customer/customer-admin-controls";
import { Button } from "@/components/ui/button";
import { controlCustomerConversationAction } from "./actions";
import { CustomerConversationMessageForm } from "./customer-conversation-message-form";

export function CustomerConversationControls({
  conversationId,
  version,
  state,
  compact = false,
}: {
  conversationId: string;
  version: number;
  state: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [step, setStep] = useState<string>("INTRODUCTION");
  async function run(
    action: "resume" | "pause" | "step" | "restart" | "close"
  ) {
    const confirmations = {
      step: `Ir para ${step} e reenviar a pergunta? Os dados necessários serão validados.`,
      restart:
        "Reiniciar do início? O pedido vinculado será cancelado, se permitido. O histórico será preservado.",
      close: "Encerrar a conversa e cancelar o pedido vinculado, se permitido?",
    };
    if (
      action in confirmations &&
      !window.confirm(confirmations[action as keyof typeof confirmations])
    )
      return;
    setPending(true);
    setFeedback(null);
    try {
      const result = await controlCustomerConversationAction({
        conversationId,
        expectedVersion: version,
        action,
        step,
      });
      setFeedback(
        result.ok
          ? { ok: true, text: "Conversa atualizada. Mensagens aguardam envio." }
          : { ok: false, text: result.error }
      );
      router.refresh();
    } catch {
      setFeedback({
        ok: false,
        text: "Não foi possível alterar a conversa. Tente novamente.",
      });
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-3">
      <fieldset
        disabled={pending}
        className="flex flex-wrap items-center gap-2 disabled:opacity-60"
      >
        {["PAUSED", "MANUAL_REVIEW"].includes(state) && (
          <Button size="sm" onClick={() => void run("resume")}>
            Retomar automação
          </Button>
        )}
        {!["PAUSED", "COMPLETED"].includes(state) && (
          <Button size="sm" variant="outline" onClick={() => void run("pause")}>
            Assumir / pausar
          </Button>
        )}
        {state !== "COMPLETED" && (
          <CustomerConversationMessageForm
            conversationId={conversationId}
            version={version}
          />
        )}
        {!compact && (
          <>
            {state !== "COMPLETED" && (
              <>
                <label className="text-sm">
                  Etapa{" "}
                  <select
                    className="rounded border p-2"
                    value={step}
                    onChange={(e) => setStep(e.target.value)}
                  >
                    {CUSTOMER_ADMIN_STEPS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void run("step")}
                >
                  Ir para etapa
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void run("close")}
                >
                  Encerrar / cancelar
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void run("restart")}
            >
              Reiniciar conversa
            </Button>
          </>
        )}
      </fieldset>
      {feedback && (
        <p
          role={feedback.ok ? "status" : "alert"}
          className={
            feedback.ok ? "text-sm text-green-700" : "text-sm text-red-700"
          }
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
