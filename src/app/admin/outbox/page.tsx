import Link from "next/link";
import { RefreshCw, Trash2, AlertCircle, Clock, Send, RotateCcw } from "lucide-react";
import { prisma } from "@/infrastructure/db/prisma-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { SubmitButton, SubmitButtonRaw } from "@/components/ui/submit-button";
import { ActionFeedbackForm } from "@/components/ui/action-feedback-form";
import { formatDateTime, formatPhone, formatRelative } from "@/lib/format";
import {
  retryOutboxMessageAction,
  retryAllDeadLettersAction,
  discardOutboxMessageAction,
  retryOutboxMessagesAction,
  discardOutboxMessagesAction,
} from "./actions";
import { SelectAllCheckbox } from "./select-all-checkbox";

const BATCH_FORM_ID = "outbox-batch";
const PAGE_SIZE = 50;
const FILTERS = [
  { value: "all", label: "Todas com falha" },
  { value: "DEAD_LETTER", label: "Falhas permanentes" },
  { value: "FAILED", label: "Com nova tentativa" },
] as const;

const TYPE_LABEL: Record<string, string> = {
  TEXT: "Texto",
  AUDIO: "Áudio",
  IMAGE: "Imagem",
  DOCUMENT: "Documento",
};

function recipientPhone(recipient: string): string | null {
  const digits = recipient.split("@")[0]!.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

export default async function OutboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const params = await searchParams;
  const filter = FILTERS.find((item) => item.value === params.filter)?.value ?? "all";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const statusWhere =
    filter === "all"
      ? { status: { in: ["FAILED", "DEAD_LETTER"] as Array<"FAILED" | "DEAD_LETTER"> } }
      : { status: filter };

  const [messages, total, pending, failedCount, deadCount] = await Promise.all([
    prisma.outboxMessage.findMany({
      where: statusWhere,
      orderBy: [{ status: "desc" }, { updatedAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.outboxMessage.count({ where: statusWhere }),
    prisma.outboxMessage.count({ where: { status: "PENDING" } }),
    prisma.outboxMessage.count({ where: { status: "FAILED" } }),
    prisma.outboxMessage.count({ where: { status: "DEAD_LETTER" } }),
  ]);

  const phones = [
    ...new Set(messages.map((message) => recipientPhone(message.recipient)).filter((phone): phone is string => !!phone)),
  ];
  const [users, leads] = phones.length
    ? await Promise.all([
        prisma.user.findMany({
          where: { phoneE164: { in: phones } },
          select: {
            fullName: true,
            phoneE164: true,
            customerBookingConversations: { select: { id: true }, take: 1, orderBy: { updatedAt: "desc" } },
          },
        }),
        prisma.recruitmentLead.findMany({
          where: { phoneE164: { in: phones } },
          select: { id: true, fullName: true, phoneE164: true },
        }),
      ])
    : [[], []];
  const userByPhone = new Map(users.map((user) => [user.phoneE164, user]));
  const leadByPhone = new Map(leads.map((lead) => [lead.phoneE164, lead]));

  const now = new Date();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (target: number) =>
    `/admin/outbox?${new URLSearchParams({ ...(filter !== "all" ? { filter } : {}), page: String(target) }).toString()}`;

  return (
    <div className="max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Mensagens enviadas pelo WhatsApp</h1>
        <p className="text-sm text-slate-500 mt-0.5">Acompanhe o que não foi entregue, recoloque na fila ou descarte</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle as="p">Na fila</CardTitle>
              <Clock className="w-4 h-4 text-slate-400" aria-hidden />
            </div>
            <p className="text-3xl font-bold text-slate-900 tabular-nums">{pending}</p>
          </CardHeader>
        </Card>
        <Card className={failedCount > 0 ? "border-amber-200" : ""}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle as="p" className={failedCount > 0 ? "text-amber-500" : ""}>Com nova tentativa</CardTitle>
              <AlertCircle className={`w-4 h-4 ${failedCount > 0 ? "text-amber-400" : "text-slate-400"}`} aria-hidden />
            </div>
            <p className={`text-3xl font-bold tabular-nums ${failedCount > 0 ? "text-amber-600" : "text-slate-900"}`}>{failedCount}</p>
          </CardHeader>
        </Card>
        <Card className={deadCount > 0 ? "border-red-200" : ""}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle as="p" className={deadCount > 0 ? "text-red-500" : ""}>Falhas permanentes</CardTitle>
              <Send className={`w-4 h-4 ${deadCount > 0 ? "text-red-400" : "text-slate-400"}`} aria-hidden />
            </div>
            <p className={`text-3xl font-bold tabular-nums ${deadCount > 0 ? "text-red-600" : "text-slate-900"}`}>{deadCount}</p>
          </CardHeader>
        </Card>
      </div>

      <nav aria-label="Filtrar mensagens" className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((item) => (
          <Link
            key={item.value}
            href={item.value === "all" ? "/admin/outbox" : `/admin/outbox?filter=${item.value}`}
            aria-current={filter === item.value ? "page" : undefined}
            className="rounded border border-slate-200 bg-white px-3 py-2 min-h-11 inline-flex items-center aria-[current=page]:ring-2 aria-[current=page]:ring-blue-500"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {messages.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <RefreshCw className="w-8 h-8 text-slate-300 mx-auto mb-2" aria-hidden />
            <p className="text-sm font-medium text-slate-600">Fila saudável</p>
            <p className="text-xs text-slate-400 mt-1">Nenhuma mensagem com falha neste filtro.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle as="h2">
                {total} mensagem{total === 1 ? "" : "ns"}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <ActionFeedbackForm
                  id={BATCH_FORM_ID}
                  action={async (formData) => {
                    "use server";
                    return formData.get("intent") === "discard"
                      ? discardOutboxMessagesAction(formData)
                      : retryOutboxMessagesAction(formData);
                  }}
                  className="flex flex-wrap items-center gap-2"
                >
                  <button
                    type="submit"
                    name="intent"
                    value="retry"
                    className="inline-flex items-center gap-1.5 min-h-11 sm:min-h-0 text-xs font-medium text-blue-700 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded px-3 py-1.5"
                  >
                    <RefreshCw className="w-3 h-3" aria-hidden />
                    Recolocar selecionadas
                  </button>
                  <ConfirmButton
                    name="intent"
                    value="discard"
                    message="Descartar as mensagens selecionadas? Elas não serão enviadas e a ação não pode ser desfeita."
                    className="inline-flex items-center gap-1.5 min-h-11 sm:min-h-0 text-xs font-medium text-red-700 border border-red-200 bg-red-50 hover:bg-red-100 rounded px-3 py-1.5"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden />
                    Descartar selecionadas
                  </ConfirmButton>
                </ActionFeedbackForm>
                {deadCount > 0 && (
                  <ActionFeedbackForm
                    action={async () => {
                      "use server";
                      return retryAllDeadLettersAction();
                    }}
                  >
                    <SubmitButton
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-900 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded px-2.5 py-1 transition-colors"
                      pendingLabel="Recolocando…"
                    >
                      <RotateCcw className="w-3 h-3" aria-hidden />
                      Recolocar todas as permanentes
                    </SubmitButton>
                  </ActionFeedbackForm>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0 pb-0">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-t border-slate-100 bg-slate-50">
                  <th className="px-4 py-2.5 w-10">
                    <SelectAllCheckbox formId={BATCH_FORM_ID} />
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Destinatário</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Situação</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Último erro</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Atualizado</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {messages.map((message) => {
                  const payload = message.payload as { text?: string };
                  const phone = recipientPhone(message.recipient);
                  const user = phone ? userByPhone.get(phone) : undefined;
                  const lead = phone ? leadByPhone.get(phone) : undefined;
                  const conversationId = user?.customerBookingConversations[0]?.id;
                  const dead = message.status === "DEAD_LETTER";
                  return (
                    <tr key={message.id} className={dead ? "hover:bg-red-50/50" : "hover:bg-amber-50/50"}>
                      <td className="px-4 py-3 align-top">
                        <input
                          type="checkbox"
                          name="ids"
                          value={message.id}
                          form={BATCH_FORM_ID}
                          className="h-4 w-4"
                          aria-label={`Selecionar mensagem para ${formatPhone(phone ?? message.recipient)}`}
                        />
                      </td>
                      <td className="px-3 py-3 align-top">
                        <p className="text-sm font-medium text-slate-900">
                          {user?.fullName ?? lead?.fullName ?? "Contato desconhecido"}
                        </p>
                        <p className="text-xs text-slate-500">{formatPhone(phone ?? message.recipient)}</p>
                        <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                          {conversationId && (
                            <Link href={`/admin/customer-conversations/${conversationId}`} className="text-blue-700 hover:underline">
                              Ver conversa
                            </Link>
                          )}
                          {lead && (
                            <Link href={`/admin/recruitment/${lead.id}`} className="text-blue-700 hover:underline">
                              Ver profissional
                            </Link>
                          )}
                        </p>
                        {payload.text && <p className="text-xs text-slate-500 line-clamp-2 mt-1 max-w-xs">{payload.text}</p>}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <Badge variant={dead ? "destructive" : "warning"}>{dead ? "Falha permanente" : "Nova tentativa"}</Badge>
                        <p className="text-xs text-slate-500 mt-1">
                          {message.attempts} tentativa{message.attempts === 1 ? "" : "s"} · {TYPE_LABEL[message.type] ?? message.type}
                        </p>
                        {!dead && (
                          <p className="text-xs text-slate-500">
                            {message.availableAt > now ? `Próxima ${formatRelative(message.availableAt, now)}` : "Pronta para envio"}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top hidden lg:table-cell">
                        {message.lastError ? (
                          <p className="text-xs text-red-600 font-mono line-clamp-3 max-w-[16rem]">{message.lastError}</p>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-slate-500 hidden md:table-cell" title={formatDateTime(message.updatedAt)}>
                        {formatRelative(message.updatedAt, now)}
                        <span className="block text-slate-400">{formatDateTime(message.updatedAt)}</span>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex flex-col items-end gap-2">
                          <ActionFeedbackForm
                            action={async () => {
                              "use server";
                              return retryOutboxMessageAction(message.id);
                            }}
                          >
                            <SubmitButtonRaw
                              className="inline-flex items-center gap-1 min-h-11 sm:min-h-0 text-xs font-medium text-blue-700 hover:text-blue-900"
                              aria-label="Recolocar na fila"
                            >
                              <RefreshCw className="w-3 h-3" aria-hidden />
                              Recolocar
                            </SubmitButtonRaw>
                          </ActionFeedbackForm>
                          <ActionFeedbackForm
                            action={async () => {
                              "use server";
                              return discardOutboxMessageAction(message.id);
                            }}
                          >
                            <ConfirmButton
                              message="Descartar esta mensagem? Ela não será enviada e a ação não pode ser desfeita."
                              className="inline-flex items-center gap-1 min-h-11 sm:min-h-0 text-xs font-medium text-red-600 hover:text-red-800"
                              aria-label="Descartar mensagem"
                            >
                              <Trash2 className="w-3 h-3" aria-hidden />
                              Descartar
                            </ConfirmButton>
                          </ActionFeedbackForm>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {totalPages > 1 && (
        <nav aria-label="Paginação" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="text-blue-700 hover:underline">← Anterior</Link>
          ) : (
            <span />
          )}
          <span className="text-slate-500">Página {page} de {totalPages}</span>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className="text-blue-700 hover:underline">Próxima →</Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
