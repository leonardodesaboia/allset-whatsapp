import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MessageCircle, User, Bot } from "lucide-react";
import { prisma } from "@/infrastructure/db/prisma-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

import { CustomerConversationControls } from "../customer-conversation-controls";

const fmt = (d: Date) =>
  d.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Fortaleza",
  });

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const conversation = await prisma.customerBookingConversation.findUnique({
    where: { id },
    include: {
      customer: { select: { fullName: true, phoneE164: true } },
      booking: { select: { id: true, status: true } },
    },
  });
  if (!conversation) notFound();

  const phone = conversation.customer.phoneE164;

  const [inboundMessages, outboundMessages, auditHistory, bookingHistory] =
    await Promise.all([
      prisma.inboundMessage.findMany({
        where: { sender: phone },
        orderBy: { receivedAt: "desc" },
        take: 200,
      }),
      prisma.outboxMessage.findMany({
        where: { correlationId: id },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.auditLog.findMany({
        where: { entityType: "CustomerBookingConversation", entityId: id },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.bookingStatusHistory.findMany({
        where: { bookingId: conversation.bookingId ?? "" },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);
  const lastQuestion = conversation.lastQuestionKey;
  const lastQuestionMessage = outboundMessages.find(
    (message) =>
      lastQuestion &&
      message.idempotencyKey.startsWith(
        `customer-booking:${id}:${lastQuestion}:`
      )
  );
  const lastQuestionText = (
    lastQuestionMessage?.payload as { text?: string } | undefined
  )?.text;
  const lastAdminAction = auditHistory[0];
  const reviewReason = bookingHistory.find(
    (entry) => entry.toStatus === "REVIEW_REQUIRED"
  )?.reason;
  const pauseNotice = outboundMessages.find(
    (message) =>
      conversation.automationPausedAt &&
      message.createdAt >= conversation.automationPausedAt &&
      /:(human-help|stopped):/.test(message.idempotencyKey)
  );
  const pauseReason =
    conversation.misunderstandingCount >= 2
      ? "Respostas não compreendidas repetidamente"
      : lastAdminAction?.action.includes("PAUS") ||
          lastAdminAction?.action.includes("MANUAL_MESSAGE")
        ? `Atendimento assumido por ${lastAdminAction.actor}`
        : pauseNotice?.idempotencyKey.includes(":human-help:")
          ? "Cliente solicitou atendimento humano"
          : pauseNotice
            ? "Cliente solicitou parar a automação"
            : "Motivo não registrado para esta conversa";

  type MsgItem =
    | { kind: "inbound"; id: string; text: string; at: Date }
    | {
        kind: "outbound";
        id: string;
        text: string;
        at: Date;
        status: string;
        lastError: string | null;
      };

  const timeline: MsgItem[] = [
    ...inboundMessages.map((m) => {
      const payload = m.payload as { text?: string; type?: string };
      const text =
        payload.text ?? (payload.type === "audio" ? "[Áudio]" : "[Mídia]");
      return { kind: "inbound" as const, id: m.id, text, at: m.receivedAt };
    }),
    ...outboundMessages.map((m) => {
      const payload = m.payload as { text?: string; type?: string };
      const text =
        payload.text ?? (payload.type === "AUDIO" ? "[Áudio]" : "[Mensagem]");
      return {
        kind: "outbound" as const,
        id: m.id,
        text,
        at: m.sentAt ?? m.createdAt,
        status: m.status,
        lastError: m.lastError,
      };
    }),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="p-6 max-w-2xl space-y-5">
      <Link
        href="/admin/customer-conversations"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Conversas
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {conversation.customer.fullName}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">{phone}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={
              conversation.state === "COMPLETED"
                ? "success"
                : ["PAUSED", "MANUAL_REVIEW"].includes(conversation.state)
                  ? "warning"
                  : "secondary"
            }
          >
            {conversation.state}
          </Badge>
          {conversation.booking && (
            <Link
              href={`/admin/bookings/${conversation.booking.id}/opportunity`}
              className="text-xs text-blue-600 hover:underline"
            >
              Ver agendamento →
            </Link>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-sm">
            Estado atual: <strong>{conversation.state}</strong> · Versão{" "}
            {conversation.version}
          </p>
          <p className="text-sm">
            Última pergunta (etapa): {lastQuestion ?? "Nenhuma"}
          </p>
          {lastQuestionText && (
            <p className="whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm">
              {lastQuestionText}
            </p>
          )}
          {conversation.state === "PAUSED" && (
            <p className="text-sm text-amber-800">
              Motivo da pausa: {pauseReason}
            </p>
          )}
          {conversation.state === "MANUAL_REVIEW" && (
            <p className="text-sm text-amber-800">
              Motivo da revisão:{" "}
              {reviewReason ??
                (conversation.bookingId
                  ? "Configuração ou dados pendentes; verifique o pedido e o histórico."
                  : "Preços ou serviço não configurados quando a conversa entrou em revisão.")}
            </p>
          )}
          <CustomerConversationControls
            conversationId={id}
            version={conversation.version}
            state={conversation.state}
          />
        </CardContent>
      </Card>
      <details className="rounded border p-3 text-sm">
        <summary>Histórico administrativo ({auditHistory.length})</summary>
        <ul className="mt-2 space-y-2">
          {auditHistory.map((entry) => (
            <li key={entry.id}>
              {fmt(entry.createdAt)} · {entry.actor} · {entry.action}
              <pre className="whitespace-pre-wrap text-xs">
                {JSON.stringify(entry.metadata)}
              </pre>
            </li>
          ))}
        </ul>
      </details>
      <p className="text-xs text-slate-500">
        Últimas 200 entradas deste cliente e 200 saídas desta conversa. O
        histórico é preservado ao reiniciar.
      </p>
      {timeline.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <MessageCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-400">
              Nenhuma mensagem encontrada para este número.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{timeline.length} mensagens</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-4">
            <div className="space-y-1 px-4">
              {timeline.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-2 ${msg.kind === "outbound" ? "flex-row-reverse" : ""}`}
                >
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-1 ${
                      msg.kind === "inbound" ? "bg-slate-200" : "bg-blue-600"
                    }`}
                  >
                    {msg.kind === "inbound" ? (
                      <User className="w-3 h-3 text-slate-600" />
                    ) : (
                      <Bot className="w-3 h-3 text-white" />
                    )}
                  </div>

                  <div
                    className={`max-w-[75%] ${msg.kind === "outbound" ? "items-end" : "items-start"} flex flex-col gap-0.5`}
                  >
                    <div
                      className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                        msg.kind === "inbound"
                          ? "bg-slate-100 text-slate-800 rounded-tl-none"
                          : "bg-blue-600 text-white rounded-tr-none"
                      }`}
                    >
                      {msg.text}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-400">
                        {fmt(msg.at)}
                      </span>
                      {msg.kind === "outbound" && (
                        <Badge
                          variant={
                            msg.status === "SENT"
                              ? "success"
                              : msg.status === "DEAD_LETTER"
                                ? "destructive"
                                : "warning"
                          }
                          className="text-[9px] h-3.5 px-1"
                        >
                          {msg.status}
                        </Badge>
                      )}
                    </div>
                    {msg.kind === "outbound" && msg.lastError && (
                      <p className="text-xs text-red-700">{msg.lastError}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
