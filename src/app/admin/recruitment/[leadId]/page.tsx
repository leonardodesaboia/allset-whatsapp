import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Phone,
  MapPin,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  FileText,
  BookOpen,
  Beaker,
  ShieldCheck,
  Pin,
  Calendar,
  MessageCircle,
  User,
  Bot,
} from "lucide-react";
import { prisma } from "@/infrastructure/db/prisma-client";
import { LeadWorkflowActions } from "../lead-workflow-actions";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  reviewDocumentAction,
  completeOnboardingContentAction,
  startOperationalTestAction,
  decideOperationalTestAction,
  recordValidationServiceAction,
  decideValidationAction,
} from "../actions";

export default async function LeadProfilePage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;

  const [lead, requirements, onboardingContents, validationPolicy] = await Promise.all([
    prisma.recruitmentLead.findUnique({
      where: { id: leadId },
      include: {
        notes: { where: { deletedAt: null }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }] },
        events: { orderBy: { occurredAt: "desc" }, take: 30 },
        interviews: { orderBy: { startedAt: "desc" } },
        assessments: { orderBy: { createdAt: "desc" } },
        references: { include: { verifications: { orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" } },
        documents: { include: { requirement: true, reviews: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { receivedAt: "desc" } },
        onboardingProgress: { include: { content: true } },
        operationalTests: { include: { events: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" }, take: 1 },
        validationServices: { orderBy: { createdAt: "desc" } },
        validationDecisions: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.documentRequirement.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.onboardingContent.findMany({ where: { isActive: true }, orderBy: { position: "asc" } }),
    prisma.validationPolicy.findFirst({ where: { isActive: true }, orderBy: { createdAt: "desc" } }),
  ]);

  if (!lead) notFound();

  const [inboundMessages, outboundMessages] = lead.phoneE164
    ? await Promise.all([
        prisma.inboundMessage.findMany({
          where: { sender: lead.phoneE164 },
          orderBy: { receivedAt: "asc" },
          take: 150,
        }),
        prisma.outboxMessage.findMany({
          where: { recipient: lead.phoneE164, status: { in: ["SENT", "FAILED", "DEAD_LETTER"] } },
          orderBy: { createdAt: "asc" },
          take: 150,
        }),
      ])
    : [[], []] as const;

  const openInterview = lead.interviews.find((i) => !i.endedAt);
  const latestReference = lead.references[0];
  const activeTest = lead.operationalTests[0];
  const completedContentIds = new Set(lead.onboardingProgress.map((p) => p.contentId));
  const latestDecision = lead.validationDecisions[0];
  const overdue = lead.nextActionAt != null && lead.nextActionAt < new Date();

  return (
    <div className="p-6 max-w-3xl space-y-5">
      {/* Back + Header */}
      <div className="flex items-start gap-4">
        <Link
          href="/admin/recruitment"
          className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Profissionais
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {lead.fullName ?? <span className="text-slate-400 italic">(sem nome)</span>}
          </h1>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <StatusBadge status={lead.status} />
            {lead.phoneE164 && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <Phone className="w-3 h-3" /> {lead.phoneE164}
              </span>
            )}
            {lead.neighborhood && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <MapPin className="w-3 h-3" /> {lead.neighborhood}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Next action alert */}
      {lead.nextAction && (
        <div className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm ${
          overdue ? "bg-red-50 border border-red-200 text-red-700" : "bg-amber-50 border border-amber-200 text-amber-800"
        }`}>
          {overdue ? <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <Clock className="w-4 h-4 shrink-0 mt-0.5" />}
          <span>
            {overdue ? <strong>ATRASADO — </strong> : "Próxima ação: "}
            {lead.nextAction}
            {lead.nextActionAt && ` (${lead.nextActionAt.toLocaleDateString("pt-BR")})`}
          </span>
        </div>
      )}

      {/* Workflow Actions */}
      <LeadWorkflowActions
        leadId={lead.id}
        {...(openInterview ? { openInterviewId: openInterview.id } : {})}
        {...(latestReference ? { latestReferenceId: latestReference.id } : {})}
      />

      {/* Entrevistas */}
      <Card>
        <CardHeader>
          <CardTitle>Entrevistas</CardTitle>
        </CardHeader>
        <CardContent>
          {lead.interviews.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma entrevista registrada.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {lead.interviews.map((i) => (
                <div key={i.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-slate-600">{i.startedAt.toLocaleDateString("pt-BR")}</span>
                    {i.notes && <span className="text-slate-500 truncate max-w-xs">— {i.notes}</span>}
                  </div>
                  {i.result ? (
                    <Badge variant="success">{i.result}</Badge>
                  ) : (
                    <Badge variant="warning">Em andamento</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Avaliações */}
      <Card>
        <CardHeader>
          <CardTitle>Avaliações internas</CardTitle>
        </CardHeader>
        <CardContent>
          {lead.assessments.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma avaliação registrada.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {lead.assessments.map((a) => (
                <div key={a.id} className="py-2 text-sm text-slate-600">
                  {[
                    a.experience != null && `Exp: ${a.experience}`,
                    a.reliability != null && `Confiabilidade: ${a.reliability}`,
                    a.communication != null && `Comunicação: ${a.communication}`,
                  ].filter(Boolean).join(" · ")}
                  {a.notes && <p className="text-slate-500 mt-0.5">{a.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Referências */}
      <Card>
        <CardHeader>
          <CardTitle>Referências</CardTitle>
        </CardHeader>
        <CardContent>
          {lead.references.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma referência registrada.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {lead.references.map((r) => (
                <div key={r.id} className="py-2 flex items-start gap-3 text-sm">
                  <div className="flex-1">
                    <p className="font-semibold text-slate-900">{r.name}</p>
                    {r.verifications[0]?.comment && (
                      <p className="text-slate-500 mt-0.5">{r.verifications[0].comment}</p>
                    )}
                    {r.verifications[0]?.wouldHireAgain != null && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        Recontrataria: {r.verifications[0].wouldHireAgain ? "Sim" : "Não"}
                      </p>
                    )}
                  </div>
                  <Badge variant={r.status === "CONFIRMED" ? "success" : r.status === "NEGATIVE" ? "destructive" : "secondary"}>
                    {r.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Documentos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Documentos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {requirements.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhum requisito documental configurado.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {requirements.map((req) => {
                const doc = lead.documents.find((d) => d.requirementId === req.id);
                return (
                  <div key={req.id} className="py-3 flex items-start gap-3 text-sm">
                    <div className="flex-1">
                      <p className="font-semibold text-slate-900">
                        {req.name}
                        {req.required && <span className="ml-1 text-red-500 text-xs">*</span>}
                      </p>
                      {doc ? (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {doc.contentType} · {(doc.sizeBytes / 1024).toFixed(0)} KB
                          {doc.reviews[0]?.reason && ` — ${doc.reviews[0].reason}`}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-400 italic mt-0.5">Não enviado</p>
                      )}
                    </div>
                    {doc ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant={
                          doc.status === "APPROVED" ? "success" :
                          doc.status === "REJECTED" ? "destructive" : "warning"
                        }>
                          {doc.status === "RECEIVED" ? "Aguardando" :
                           doc.status === "APPROVED" ? "Aprovado" :
                           doc.status === "REJECTED" ? "Rejeitado" : doc.status}
                        </Badge>
                        {doc.status === "RECEIVED" && (
                          <div className="flex gap-1">
                            <form action={async () => {
                              "use server";
                              await reviewDocumentAction({ documentId: doc.id, leadId, status: "APPROVED" });
                            }}>
                              <button
                                type="submit"
                                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                              >
                                <CheckCircle2 className="w-3 h-3" /> Aprovar
                              </button>
                            </form>
                            <RejectDocumentForm documentId={doc.id} leadId={leadId} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <XCircle className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Onboarding */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5" />
            Onboarding
          </CardTitle>
        </CardHeader>
        <CardContent>
          {onboardingContents.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhum conteúdo configurado.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {onboardingContents.map((content) => {
                const done = completedContentIds.has(content.id);
                return (
                  <div key={content.id} className="py-2.5 flex items-start gap-3 text-sm">
                    <div className="mt-0.5 shrink-0">
                      {done
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        : <div className="w-4 h-4 rounded-full border-2 border-slate-300" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-semibold ${done ? "text-slate-400 line-through" : "text-slate-900"}`}>
                        {content.title}
                      </p>
                      {content.text && (
                        <p className="text-xs text-slate-500 mt-0.5 truncate">
                          {content.text.slice(0, 100)}{content.text.length > 100 ? "…" : ""}
                        </p>
                      )}
                    </div>
                    {!done && (
                      <form action={async () => {
                        "use server";
                        await completeOnboardingContentAction({ leadId, contentId: content.id });
                      }}>
                        <button
                          type="submit"
                          className="shrink-0 inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Concluído
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Teste operacional */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Beaker className="w-3.5 h-3.5" />
            Teste operacional
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!activeTest ? (
            lead.status === "TESTE_OPERACIONAL" ? (
              <form action={async () => { "use server"; await startOperationalTestAction(leadId); }}>
                <Button type="submit" variant="secondary" size="sm">Iniciar teste</Button>
              </form>
            ) : (
              <p className="text-sm text-slate-400">Nenhum teste registrado.</p>
            )
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant={
                  activeTest.result === "PASSED" || activeTest.result === "PASSED_WITH_SUPPORT" ? "success" :
                  activeTest.result === "FAILED" ? "destructive" : "warning"
                }>
                  {activeTest.result ?? "Em andamento"}
                </Badge>
                {activeTest.supportUsed && <Badge variant="secondary">Suporte usado</Badge>}
              </div>

              {activeTest.events.length > 0 && (
                <div className="text-xs text-slate-500 space-y-0.5">
                  {activeTest.events.map((e) => (
                    <p key={e.id}>{e.type} — {e.actor}</p>
                  ))}
                </div>
              )}

              {!activeTest.result && (
                <div className="flex flex-wrap gap-2">
                  <form action={async () => { "use server"; await decideOperationalTestAction({ testId: activeTest.id, leadId, result: "PASSED" }); }}>
                    <Button type="submit" variant="success" size="sm">Aprovado</Button>
                  </form>
                  <form action={async () => { "use server"; await decideOperationalTestAction({ testId: activeTest.id, leadId, result: "PASSED_WITH_SUPPORT" }); }}>
                    <Button type="submit" variant="secondary" size="sm">Aprovado c/ suporte</Button>
                  </form>
                  <form action={async () => { "use server"; await decideOperationalTestAction({ testId: activeTest.id, leadId, result: "FAILED" }); }}>
                    <Button type="submit" variant="destructive" size="sm">Reprovado</Button>
                  </form>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Validação */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            Validação
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {validationPolicy && (
            <p className="text-xs text-slate-500">
              Política: {validationPolicy.requiredServices} serviço(s) necessário(s)
            </p>
          )}

          {lead.validationServices.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhum serviço registrado.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {lead.validationServices.map((s) => (
                <div key={s.id} className="py-2 text-sm text-slate-600">
                  <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{s.externalServiceId}</span>
                  <span className="ml-2">
                    {[
                      s.rating != null && `Nota: ${s.rating}`,
                      s.wasOnTime != null && (s.wasOnTime ? "Pontual" : "Não pontual"),
                      s.hadIssue && "Problema reportado",
                      s.wouldHireAgain != null && `Recontrataria: ${s.wouldHireAgain}`,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </div>
              ))}
            </div>
          )}

          {lead.status === "EM_VALIDACAO" && (
            <>
              <RecordValidationServiceForm leadId={leadId} />
              {!latestDecision && <ValidationDecisionForm leadId={leadId} />}
            </>
          )}

          {latestDecision && (
            <div className="flex items-center gap-2">
              <Badge variant={
                latestDecision.decision === "ATIVA" || latestDecision.decision === "PREFERENCIAL" ? "success" :
                latestDecision.decision === "REPROVADA" ? "destructive" : "secondary"
              }>
                {latestDecision.decision}
              </Badge>
              {latestDecision.reason && (
                <span className="text-xs text-slate-500">{latestDecision.reason}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notas internas */}
      <Card>
        <CardHeader>
          <CardTitle>Notas internas</CardTitle>
        </CardHeader>
        <CardContent>
          {lead.notes.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma nota.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {lead.notes.map((n) => (
                <div key={n.id} data-testid="note-item" className="py-2.5 text-sm">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {n.pinned && <Pin className="w-3 h-3 text-amber-500 shrink-0" />}
                    <Badge variant="outline" className="text-[10px] h-4">{n.type}</Badge>
                    <span className="text-xs text-slate-400">{n.author}</span>
                  </div>
                  <p className="text-slate-700">{n.content}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mensagens WhatsApp */}
      {(inboundMessages.length > 0 || outboundMessages.length > 0) && (() => {
        type MsgItem =
          | { kind: "inbound"; id: string; text: string; at: Date }
          | { kind: "outbound"; id: string; text: string; at: Date; status: string };

        const timeline: MsgItem[] = [
          ...inboundMessages.map((m) => {
            const p = m.payload as { text?: string; type?: string };
            return { kind: "inbound" as const, id: m.id, text: p.text ?? (p.type === "audio" ? "[Áudio]" : "[Mídia]"), at: m.receivedAt };
          }),
          ...outboundMessages.map((m) => {
            const p = m.payload as { text?: string; type?: string };
            return { kind: "outbound" as const, id: m.id, text: p.text ?? "[Mensagem]", at: m.sentAt ?? m.createdAt, status: m.status };
          }),
        ].sort((a, b) => a.at.getTime() - b.at.getTime());

        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <MessageCircle className="w-3.5 h-3.5" />
                Conversa WhatsApp ({timeline.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-4">
              <div className="space-y-1 px-4 max-h-96 overflow-y-auto">
                {timeline.map((msg) => (
                  <div key={msg.id} className={`flex gap-2 ${msg.kind === "outbound" ? "flex-row-reverse" : ""}`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-1 ${
                      msg.kind === "inbound" ? "bg-slate-200" : "bg-blue-600"
                    }`}>
                      {msg.kind === "inbound"
                        ? <User className="w-2.5 h-2.5 text-slate-600" />
                        : <Bot className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <div className={`max-w-[75%] flex flex-col gap-0.5 ${msg.kind === "outbound" ? "items-end" : "items-start"}`}>
                      <div className={`rounded-2xl px-3 py-1.5 text-sm leading-relaxed ${
                        msg.kind === "inbound"
                          ? "bg-slate-100 text-slate-800 rounded-tl-none"
                          : "bg-blue-600 text-white rounded-tr-none"
                      }`}>
                        {msg.text}
                      </div>
                      <span className="text-[10px] text-slate-400">
                        {msg.at.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Fortaleza" })}
                        {msg.kind === "outbound" && msg.status !== "SENT" && (
                          <span className="ml-1 text-red-500">({msg.status})</span>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Linha do tempo */}
      <Card>
        <CardHeader>
          <CardTitle>Linha do tempo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-slate-100">
            {lead.events.map((e) => (
              <div key={e.id} className="py-2 flex items-start gap-3 text-sm">
                <span className="text-xs text-slate-400 tabular-nums shrink-0 pt-px">
                  {e.occurredAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </span>
                <span className="text-slate-700 flex-1">{e.description}</span>
                <span className="text-xs text-slate-400 shrink-0">{e.actor}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RejectDocumentForm({ documentId, leadId }: { documentId: string; leadId: string }) {
  return (
    <form
      className="inline-flex items-center gap-1"
      action={async (data: FormData) => {
        "use server";
        const reason = data.get("reason") as string | null;
        await reviewDocumentAction({ documentId, leadId, status: "REJECTED", ...(reason ? { reason } : {}) });
      }}
    >
      <input
        name="reason"
        placeholder="Motivo da rejeição"
        required
        className="rounded border border-slate-300 px-2 py-0.5 text-xs w-36 focus:outline-none focus:ring-1 focus:ring-red-400"
      />
      <button
        type="submit"
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
      >
        <XCircle className="w-3 h-3" /> Rejeitar
      </button>
    </form>
  );
}

function RecordValidationServiceForm({ leadId }: { leadId: string }) {
  return (
    <form
      className="flex items-center gap-2 flex-wrap"
      action={async (data: FormData) => {
        "use server";
        const ratingRaw = data.get("rating") as string | null;
        await recordValidationServiceAction({
          leadId,
          externalServiceId: data.get("externalServiceId") as string,
          ...(ratingRaw ? { rating: Number(ratingRaw) } : {}),
          wasOnTime: data.get("wasOnTime") === "true",
          hadIssue: data.get("hadIssue") === "true",
        });
      }}
    >
      <input
        name="externalServiceId"
        placeholder="ID do serviço"
        required
        className="rounded border border-slate-300 px-2 py-1 text-sm w-36 focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
      <select
        name="rating"
        className="rounded border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        <option value="">Nota</option>
        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <label className="flex items-center gap-1 text-sm text-slate-600">
        <input type="checkbox" name="wasOnTime" value="true" className="rounded" /> Pontual
      </label>
      <label className="flex items-center gap-1 text-sm text-slate-600">
        <input type="checkbox" name="hadIssue" value="true" className="rounded" /> Problema
      </label>
      <button
        type="submit"
        className="rounded px-2 py-1 text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
      >
        Registrar serviço
      </button>
    </form>
  );
}

function ValidationDecisionForm({ leadId }: { leadId: string }) {
  return (
    <form
      className="flex items-center gap-2 flex-wrap"
      action={async (data: FormData) => {
        "use server";
        await decideValidationAction({
          leadId,
          decision: data.get("decision") as "ATIVA" | "PAUSADA" | "REPROVADA" | "PREFERENCIAL",
          ...((((data.get("reason") as string | null) ?? "").trim()) ? { reason: (data.get("reason") as string).trim() } : {}),
        });
      }}
    >
      <select
        name="decision"
        required
        className="rounded border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        <option value="">Decisão final</option>
        <option value="ATIVA">Ativar</option>
        <option value="PREFERENCIAL">Preferencial</option>
        <option value="PAUSADA">Pausar</option>
        <option value="REPROVADA">Reprovar</option>
      </select>
      <input
        name="reason"
        placeholder="Motivo (obrigatório para pausar/reprovar)"
        className="rounded border border-slate-300 px-2 py-1 text-sm w-64 focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
      <button
        type="submit"
        className="rounded px-3 py-1 text-xs font-medium bg-slate-900 text-white hover:bg-slate-700"
      >
        Confirmar decisão
      </button>
    </form>
  );
}
