import Link from "next/link";
import {
  AlertTriangle,
  Users,
  CheckCircle2,
  Clock,
  XCircle,
  Star,
  FileText,
  BookOpen,
  Beaker,
  ShieldCheck,
  ThumbsUp,
  Mic,
  Filter,
  TrendingUp,
  MessageSquare,
  PauseCircle,
  Send,
  FileCheck,
  Megaphone,
  Wifi,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { prisma } from "@/infrastructure/db/prisma-client";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { getOperationsOverview } from "@/application/admin/operations-overview-read-model";
import { fetchMessagingConnectionState } from "@/infrastructure/messaging/connection-state";
import { getMessagingIntegrationConfig } from "@/infrastructure/messaging/messaging-runtime";
import { resolveInternalSchedulerStatus } from "@/infrastructure/scheduling/internal-scheduler-config";
import { formatDateTime, formatRelative } from "@/lib/format";
import { env } from "@/env";

export const dynamic = "force-dynamic";

type ActionItem = {
  key: string;
  count: number;
  label: string;
  hint: string;
  href: string;
  icon: LucideIcon;
  tone: "red" | "amber";
};

export default async function AdminHomePage() {
  const messagingConfig = getMessagingIntegrationConfig();
  const [overview, leadsByStatus, bookingCounts, connection] =
    await Promise.all([
      getOperationsOverview(prisma, {
        staleAfterHours: env.BOOKING_STALE_AFTER_HOURS,
      }),
      prisma.recruitmentLead.groupBy({
        by: ["status"],
        _count: { _all: true },
        where: { status: { in: FUNNEL_STAGES.map((stage) => stage.status) } },
      }),
      prisma.booking.groupBy({
        by: ["status"],
        _count: { _all: true },
        where: { status: { in: [...OPEN_BOOKING_STATUSES] } },
      }),
      fetchMessagingConnectionState(messagingConfig, { timeoutMs: 2500 }),
    ]);

  const scheduler = resolveInternalSchedulerStatus(env);
  const now = new Date();
  const activeLeads = leadsByStatus.reduce(
    (sum, row) => sum + row._count._all,
    0
  );
  const openBookings = bookingCounts.reduce(
    (sum, row) => sum + row._count._all,
    0
  );
  const countOf = (status: string) =>
    leadsByStatus.find((row) => row.status === status)?._count._all ?? 0;
  const bookingCount = (status: string) =>
    bookingCounts.find((row) => row.status === status)?._count._all ?? 0;

  const actions: ActionItem[] = [
    {
      key: "dead",
      count: overview.outboxDeadLetter,
      label: "mensagens com falha permanente",
      hint: "O destinatário não recebeu. Recoloque na fila ou descarte.",
      href: "/admin/outbox",
      icon: XCircle,
      tone: "red" as const,
    },
    {
      key: "manual",
      count: overview.conversationsManualReview,
      label: "conversas em revisão manual",
      hint: "A automação parou e espera uma pessoa.",
      href: "/admin/customer-conversations?state=MANUAL_REVIEW",
      icon: AlertTriangle,
      tone: "red" as const,
    },
    {
      key: "paused",
      count: overview.conversationsPaused,
      label: "conversas pausadas",
      hint: "Retome a automação ou responda manualmente.",
      href: "/admin/customer-conversations?state=PAUSED",
      icon: PauseCircle,
      tone: "amber" as const,
    },
    {
      key: "failed",
      count: overview.outboxFailed,
      label: "mensagens com falha (nova tentativa automática)",
      hint: "Serão reenviadas sozinhas; verifique o erro se persistir.",
      href: "/admin/outbox",
      icon: Send,
      tone: "amber" as const,
    },
    {
      key: "docs",
      count: overview.documentsPending,
      label: "documentos aguardando revisão",
      hint: "Aprove ou rejeite para liberar profissionais.",
      href: "/admin/documents",
      icon: FileCheck,
      tone: "amber" as const,
    },
    {
      key: "opps",
      count: overview.opportunitiesWithoutResponse,
      label: "oportunidades sem resposta",
      hint: "Enviadas aos profissionais, ainda sem aceite ou recusa.",
      href: "/admin/bookings?status=MATCHING",
      icon: Megaphone,
      tone: "amber" as const,
    },
    {
      key: "stale",
      count: overview.staleBookings,
      label: `pedidos parados há mais de ${env.BOOKING_STALE_AFTER_HOURS} h`,
      hint: "Busca de profissional ou revisão sem andamento.",
      href: "/admin/bookings",
      icon: Clock,
      tone: "amber" as const,
    },
    {
      key: "leads",
      count: overview.leadsNeedingAttention,
      label: "profissionais precisam de atenção",
      hint: "Ligação solicitada, pedido de ajuda ou próxima ação vencida.",
      href: "/admin/recruitment?needs=1",
      icon: Users,
      tone: "amber" as const,
    },
  ].filter((item) => item.count > 0);

  const connected = connection.ok && connection.state === "open";
  const connecting = connection.ok && connection.state === "connecting";
  const configured = connection.error !== "NOT_CONFIGURED";
  const configAlerts: { text: string; href: string }[] = [];
  if (overview.activePricingTiers === 0) {
    configAlerts.push({
      text: "Nenhuma faixa de preço ativa — o agendamento automático pelo WhatsApp não funciona.",
      href: "/admin/settings/pricing",
    });
  }
  if (overview.activeServices === 0) {
    configAlerts.push({
      text: "Nenhum serviço ativo — o agendamento automático pelo WhatsApp não funciona.",
      href: "/admin/settings/pricing",
    });
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Painel</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          O que precisa da sua atenção agora
        </p>
      </div>

      {configAlerts.length > 0 && (
        <div
          className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-1.5"
          role="alert"
        >
          <div className="flex items-center gap-2 text-red-800 font-semibold text-sm">
            <Settings className="w-4 h-4" aria-hidden />
            Configuração incompleta
          </div>
          {configAlerts.map((alert) => (
            <Link
              key={alert.text}
              href={alert.href}
              className="block text-sm text-red-700 hover:underline"
            >
              {alert.text}
            </Link>
          ))}
        </div>
      )}

      <section aria-labelledby="needs-action">
        <h2
          id="needs-action"
          className="text-sm font-semibold text-slate-900 mb-2"
        >
          Precisa de ação agora
        </h2>
        {actions.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <CheckCircle2
                className="w-8 h-8 text-emerald-500 mx-auto mb-2"
                aria-hidden
              />
              <p className="text-sm font-medium text-slate-700">Tudo em dia</p>
              <p className="text-xs text-slate-400 mt-1">
                Nenhuma pendência que dependa de você.
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {actions.map(
              ({ key, count, label, hint, href, icon: Icon, tone }) => (
                <li key={key}>
                  <Link
                    href={href}
                    className={`flex items-start gap-3 rounded-lg border bg-white p-4 min-h-16 transition-shadow hover:shadow-[var(--shadow-elevated)] ${tone === "red" ? "border-red-200" : "border-amber-200"}`}
                  >
                    <Icon
                      className={`w-5 h-5 mt-0.5 shrink-0 ${tone === "red" ? "text-red-500" : "text-amber-500"}`}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900">
                        <span
                          className={`tabular-nums ${tone === "red" ? "text-red-600" : "text-amber-600"}`}
                        >
                          {count}
                        </span>{" "}
                        {label}
                      </span>
                      <span className="block text-xs text-slate-500 mt-0.5">
                        {hint}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            )}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="health"
        className="grid grid-cols-1 md:grid-cols-3 gap-3"
      >
        <h2 id="health" className="sr-only">
          Saúde do sistema
        </h2>
        <Link href="/admin/settings/evolution" className="block">
          <Card className="h-full hover:shadow-[var(--shadow-elevated)] transition-shadow">
            <CardContent className="pt-4 flex items-start gap-3">
              <Wifi
                className={`w-5 h-5 mt-0.5 ${connected ? "text-emerald-500" : connecting ? "text-amber-500" : "text-red-500"}`}
                aria-hidden
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  WhatsApp ({messagingConfig.label})
                </p>
                <p
                  className={`text-xs mt-0.5 ${connected ? "text-emerald-700" : connecting ? "text-amber-700" : "text-red-600"}`}
                >
                  {!configured
                    ? "Não configurado"
                    : connected
                      ? "Conectado"
                      : connecting
                        ? "Conectando…"
                        : `Desconectado${connection.error ? ` (${connection.error})` : ""}`}
                </p>
                {overview.providerBlockedUntil && (
                  <p className="text-xs text-amber-700 mt-0.5">
                    Envio pausado até{" "}
                    {formatDateTime(overview.providerBlockedUntil)}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </Link>
        <Card>
          <CardContent className="pt-4 flex items-start gap-3">
            <Clock
              className={`w-5 h-5 mt-0.5 ${scheduler.enabled ? "text-emerald-500" : "text-amber-500"}`}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">
                Agendador interno
              </p>
              <p
                className={`text-xs mt-0.5 ${scheduler.enabled ? "text-emerald-700" : "text-amber-700"}`}
              >
                {scheduler.enabled ? "Ativo" : "Desativado"}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {scheduler.reason}
              </p>
            </div>
          </CardContent>
        </Card>
        <Link href="/admin/outbox" className="block">
          <Card className="h-full hover:shadow-[var(--shadow-elevated)] transition-shadow">
            <CardContent className="pt-4 flex items-start gap-3">
              <Send
                className={`w-5 h-5 mt-0.5 ${overview.outboxOverdue > 0 ? "text-amber-500" : "text-emerald-500"}`}
                aria-hidden
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  Fila de saída
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {overview.outboxPending} na fila
                  {overview.outboxOverdue > 0
                    ? `, ${overview.outboxOverdue} atrasada${overview.outboxOverdue > 1 ? "s" : ""}`
                    : ""}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Último envio:{" "}
                  {overview.lastMessageSentAt
                    ? `${formatRelative(overview.lastMessageSentAt, now)} (${formatDateTime(overview.lastMessageSentAt)})`
                    : "nenhum"}
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard
          href="/admin/recruitment"
          title="Profissionais no funil"
          value={activeLeads}
          note={`${countOf("ATIVA") + countOf("PREFERENCIAL")} ativas`}
        />
        <SummaryCard
          href="/admin/bookings"
          title="Pedidos em aberto"
          value={openBookings}
          note={`${bookingCount("MATCHING")} buscando profissional`}
        />
        <SummaryCard
          href="/admin/customer-conversations"
          title="Conversas travadas"
          value={
            overview.conversationsPaused + overview.conversationsManualReview
          }
          note="pausadas ou em revisão"
        />
        <SummaryCard
          href="/admin/documents"
          title="Documentos"
          value={overview.documentsPending}
          note="aguardando revisão"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Funil de profissionais
              </h2>
              <Link
                href="/admin/recruitment"
                className="text-xs text-blue-600 hover:underline"
              >
                Ver Kanban →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-3 px-0 pb-0">
            <table className="w-full">
              <tbody>
                {FUNNEL_STAGES.map(({ status, label, icon: Icon }) => {
                  const count = countOf(status);
                  return (
                    <tr
                      key={status}
                      className="border-t border-slate-100 first:border-0"
                    >
                      <td className="py-2.5 px-5">
                        <div className="flex items-center gap-2">
                          <Icon
                            className="w-3.5 h-3.5 text-slate-400 shrink-0"
                            aria-hidden
                          />
                          <span className="text-sm text-slate-600">
                            {label}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-5 text-right">
                        {count > 0 ? (
                          <span className="text-sm font-semibold text-slate-900 tabular-nums">
                            {count}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Agendamentos em aberto
              </h2>
              <Link
                href="/admin/bookings"
                className="text-xs text-blue-600 hover:underline"
              >
                Ver todos →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-3 px-0 pb-0">
            <table className="w-full">
              <tbody>
                {BOOKING_STAGES.map((status) => {
                  const count = bookingCount(status);
                  return (
                    <tr
                      key={status}
                      className="border-t border-slate-100 first:border-0"
                    >
                      <td className="py-2.5 px-5">
                        <StatusBadge status={status} />
                      </td>
                      <td className="py-2.5 px-5 text-right">
                        {count > 0 ? (
                          <span className="text-sm font-semibold text-slate-900 tabular-nums">
                            {count}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({
  href,
  title,
  value,
  note,
}: {
  href: string;
  title: string;
  value: number;
  note: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="h-full hover:shadow-[var(--shadow-elevated)] transition-shadow">
        <CardHeader>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            {title}
          </p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">
            {value}
          </p>
          <p className="text-xs text-slate-500">{note}</p>
        </CardHeader>
      </Card>
    </Link>
  );
}

const FUNNEL_STAGES = [
  { status: "LEAD", label: "Novos leads", icon: TrendingUp },
  { status: "PRE_CADASTRO", label: "Pré-cadastro", icon: Filter },
  { status: "TRIAGEM", label: "Triagem", icon: Clock },
  {
    status: "CONVERSA_PENDENTE",
    label: "Conversa pendente",
    icon: MessageSquare,
  },
  { status: "ENTREVISTA", label: "Entrevista", icon: Mic },
  { status: "REFERENCIA", label: "Referência", icon: Users },
  { status: "PRE_APROVADA", label: "Pré-aprovada", icon: ThumbsUp },
  { status: "DOCUMENTACAO", label: "Documentação", icon: FileText },
  { status: "ONBOARDING", label: "Onboarding", icon: BookOpen },
  { status: "TESTE_OPERACIONAL", label: "Teste operacional", icon: Beaker },
  { status: "EM_VALIDACAO", label: "Em validação", icon: ShieldCheck },
  { status: "ATIVA", label: "Ativas", icon: CheckCircle2 },
  { status: "PREFERENCIAL", label: "Preferenciais", icon: Star },
] as const;

const OPEN_BOOKING_STATUSES = [
  "DRAFT",
  "COLLECTING_DATA",
  "QUOTED",
  "QUOTE_ACCEPTED",
  "AWAITING_CUSTOMER_CONFIRMATION",
  "AWAITING_PAYMENT",
  "PAID",
  "MATCHING",
  "REVIEW_REQUIRED",
] as const;

const BOOKING_STAGES = [
  "COLLECTING_DATA",
  "QUOTED",
  "QUOTE_ACCEPTED",
  "MATCHING",
  "REVIEW_REQUIRED",
] as const;
