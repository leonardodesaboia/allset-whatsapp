import { RefreshCw, Trash2, AlertCircle, Clock, MessageSquare, RotateCcw } from "lucide-react";
import { prisma } from "@/infrastructure/db/prisma-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { SubmitButton, SubmitButtonRaw } from "@/components/ui/submit-button";
import { ActionFeedbackForm } from "@/components/ui/action-feedback-form";
import { retryOutboxMessageAction, retryAllDeadLettersAction, discardOutboxMessageAction } from "./actions";

const fmt = (d: Date) =>
  d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Fortaleza" });

export default async function OutboxPage() {
  const [deadLetters, failed, pending] = await Promise.all([
    prisma.outboxMessage.findMany({
      where: { status: "DEAD_LETTER" },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.outboxMessage.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.outboxMessage.count({ where: { status: "PENDING" } }),
  ]);

  return (
    <div className="max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Fila de saída</h1>
        <p className="text-sm text-slate-500 mt-0.5">Mensagens pendentes, com falha e falhas permanentes</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle as="p">Pendentes</CardTitle>
              <Clock className="w-4 h-4 text-slate-400" />
            </div>
            <p className="text-3xl font-bold text-slate-900 tabular-nums">{pending}</p>
          </CardHeader>
        </Card>
        <Card className={failed.length > 0 ? "border-amber-200" : ""}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle as="p" className={failed.length > 0 ? "text-amber-500" : ""}>Com falha</CardTitle>
              <AlertCircle className={`w-4 h-4 ${failed.length > 0 ? "text-amber-400" : "text-slate-400"}`} />
            </div>
            <p className={`text-3xl font-bold tabular-nums ${failed.length > 0 ? "text-amber-600" : "text-slate-900"}`}>
              {failed.length}
            </p>
          </CardHeader>
        </Card>
        <Card className={deadLetters.length > 0 ? "border-red-200" : ""}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle as="p" className={deadLetters.length > 0 ? "text-red-500" : ""}>Falhas permanentes</CardTitle>
              <MessageSquare className={`w-4 h-4 ${deadLetters.length > 0 ? "text-red-400" : "text-slate-400"}`} aria-hidden />
            </div>
            <p className={`text-3xl font-bold tabular-nums ${deadLetters.length > 0 ? "text-red-600" : "text-slate-900"}`}>
              {deadLetters.length}
            </p>
          </CardHeader>
        </Card>
      </div>

      {/* Dead Letters */}
      {deadLetters.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle as="h2" className="text-red-500 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" aria-hidden />
                Falhas permanentes ({deadLetters.length})
              </CardTitle>
              <ActionFeedbackForm action={async () => {
                "use server";
                return retryAllDeadLettersAction();
              }}>
                <SubmitButton
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-900 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded px-2.5 py-1 transition-colors"
                  pendingLabel="Recolocando…"
                >
                  <RotateCcw className="w-3 h-3" aria-hidden />
                  Recolocar todas na fila
                </SubmitButton>
              </ActionFeedbackForm>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0 pb-0">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-t border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Destinatário</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Tipo</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tentativas</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Último erro</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Atualizado</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deadLetters.map((msg) => {
                  const payload = msg.payload as { text?: string; type?: string };
                  return (
                    <tr key={msg.id} className="hover:bg-red-50/50">
                      <td className="px-5 py-3">
                        <p className="break-all font-mono text-xs text-slate-700">{msg.recipient}</p>
                        {payload.text && (
                          <p className="text-xs text-slate-500 truncate max-w-[200px] mt-0.5">{payload.text}</p>
                        )}
                      </td>
                      <td className="px-5 py-3 hidden md:table-cell">
                        <Badge variant={msg.type === "TEXT" ? "secondary" : "purple"}>
                          {msg.type}
                        </Badge>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-sm font-semibold text-red-600 tabular-nums">{msg.attempts}x</span>
                      </td>
                      <td className="px-5 py-3 hidden lg:table-cell">
                        {msg.lastError ? (
                          <p className="text-xs text-red-600 font-mono truncate max-w-[200px]">{msg.lastError}</p>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500 hidden md:table-cell">{fmt(msg.updatedAt)}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                          <ActionFeedbackForm action={async () => {
                            "use server";
                            return retryOutboxMessageAction(msg.id);
                          }}>
                            <button
                              type="submit"
                              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
                              aria-label="Recolocar na fila"
                            >
                              <RefreshCw className="w-3 h-3" aria-hidden />
                              Recolocar
                            </button>
                          </ActionFeedbackForm>
                          <ActionFeedbackForm action={async () => {
                            "use server";
                            return discardOutboxMessageAction(msg.id);
                          }}>
                            <ConfirmButton
                              message="Descartar esta mensagem permanentemente? Esta ação não pode ser desfeita."
                              className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-800"
                              aria-label="Descartar permanentemente"
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

      {/* Failed (em retry ativo) */}
      {failed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-amber-600 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" aria-hidden />
              Com falha — aguardando reenvio ({failed.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0 pb-0">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-t border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Destinatário</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tentativas</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Próxima tentativa</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Último erro</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {failed.map((msg) => {
                  const payload = msg.payload as { text?: string };
                  return (
                    <tr key={msg.id} className="hover:bg-amber-50/50">
                      <td className="px-5 py-3">
                        <p className="break-all font-mono text-xs text-slate-700">{msg.recipient}</p>
                        {payload.text && (
                          <p className="text-xs text-slate-500 truncate max-w-[200px] mt-0.5">{payload.text}</p>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-sm font-semibold text-amber-600 tabular-nums">{msg.attempts}x</span>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500 hidden md:table-cell">
                        {msg.availableAt > new Date()
                          ? fmt(msg.availableAt)
                          : <span className="text-emerald-600 font-medium">Pronto</span>}
                      </td>
                      <td className="px-5 py-3 hidden lg:table-cell">
                        {msg.lastError ? (
                          <p className="text-xs text-amber-700 font-mono truncate max-w-[200px]">{msg.lastError}</p>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <ActionFeedbackForm action={async () => {
                          "use server";
                          return retryOutboxMessageAction(msg.id);
                        }}>
                          <SubmitButtonRaw
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
                            aria-label="Recolocar na fila agora"
                          >
                            <RefreshCw className="w-3 h-3" aria-hidden />
                            Recolocar agora
                          </SubmitButtonRaw>
                        </ActionFeedbackForm>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {deadLetters.length === 0 && failed.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <RefreshCw className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-600">Fila saudável</p>
            <p className="text-xs text-slate-400 mt-1">Nenhuma mensagem com falha ou falha permanente.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
