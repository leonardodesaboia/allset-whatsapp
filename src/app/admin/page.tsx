import Link from "next/link";
import {
  AlertTriangle,
  Users,
  Calendar,
  MessageSquare,
  BellRing,
  TrendingUp,
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
} from "lucide-react";
import { prisma } from "@/infrastructure/db/prisma-client";
import { Card, CardHeader, CardTitle, CardValue, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";

export default async function AdminHomePage() {
  const [needsMeCount, leadsByStatus, bookingCounts, outboxCounts] = await Promise.all([
    prisma.recruitmentLead.count({
      where: {
        OR: [
          { status: "LIGACAO_SOLICITADA" },
          { status: "PRECISA_DE_AJUDA" },
          { status: "AGUARDANDO_COMPLEMENTACAO" },
          { nextActionAt: { lt: new Date() } },
        ],
      },
    }),
    prisma.recruitmentLead.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: {
        status: {
          in: [
            "LEAD", "PRE_CADASTRO", "TRIAGEM", "CONVERSA_PENDENTE", "ENTREVISTA",
            "REFERENCIA", "PRE_APROVADA", "DOCUMENTACAO", "ONBOARDING",
            "TESTE_OPERACIONAL", "EM_VALIDACAO", "ATIVA", "PREFERENCIAL",
          ],
        },
      },
    }),
    prisma.booking.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: {
        status: {
          in: [
            "DRAFT", "COLLECTING_DATA", "QUOTED", "QUOTE_ACCEPTED",
            "AWAITING_PAYMENT", "PAID", "MATCHING", "REVIEW_REQUIRED",
          ],
        },
      },
    }),
    Promise.all([
      prisma.outboxMessage.count({ where: { status: { in: ["PENDING", "FAILED"] } } }),
      prisma.outboxMessage.count({ where: { status: "DEAD_LETTER" } }),
    ]),
  ]);

  const [outboxPending, outboxDeadLetter] = outboxCounts;
  const activeLeads = leadsByStatus.reduce((s, r) => s + r._count._all, 0);
  const pendingBookings = bookingCounts.reduce((s, r) => s + r._count._all, 0);

  const countOf = (status: string) =>
    leadsByStatus.find((r) => r.status === status)?._count._all ?? 0;

  const bookingCount = (status: string) =>
    bookingCounts.find((r) => r.status === status)?._count._all ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900">Painel</h1>
        <p className="text-sm text-slate-500 mt-0.5">Visão geral da operação</p>
      </div>

      {/* Alertas */}
      {(needsMeCount > 0 || outboxDeadLetter > 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm">
            <AlertTriangle className="w-4 h-4" />
            Atenção necessária
          </div>
          {needsMeCount > 0 && (
            <Link
              href="/admin/recruitment?needs=1"
              className="flex items-center gap-2 text-sm text-amber-700 hover:text-amber-900 hover:underline"
            >
              <BellRing className="w-3.5 h-3.5" />
              {needsMeCount} lead{needsMeCount > 1 ? "s precisam" : " precisa"} de atenção imediata
            </Link>
          )}
          {outboxDeadLetter > 0 && (
            <Link
              href="/admin/outbox"
              className="flex items-center gap-2 text-sm text-amber-700 hover:text-amber-900 hover:underline"
            >
              <XCircle className="w-3.5 h-3.5" />
              {outboxDeadLetter} mensagem{outboxDeadLetter > 1 ? "s com falha permanente" : " com falha permanente"} — clique para gerenciar
            </Link>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/admin/recruitment">
          <Card className="hover:shadow-[var(--shadow-elevated)] transition-shadow cursor-pointer">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>No funil</CardTitle>
                <Users className="w-4 h-4 text-slate-400" />
              </div>
              <CardValue>{activeLeads}</CardValue>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500">
                {countOf("ATIVA") + countOf("PREFERENCIAL")} ativa{countOf("ATIVA") + countOf("PREFERENCIAL") !== 1 ? "s" : ""}
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/bookings">
          <Card className="hover:shadow-[var(--shadow-elevated)] transition-shadow cursor-pointer">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Agendamentos</CardTitle>
                <Calendar className="w-4 h-4 text-slate-400" />
              </div>
              <CardValue>{pendingBookings}</CardValue>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500">
                {bookingCount("MATCHING")} buscando profissional
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/outbox">
          <Card className="hover:shadow-[var(--shadow-elevated)] transition-shadow cursor-pointer">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Fila de saída</CardTitle>
                <MessageSquare className="w-4 h-4 text-slate-400" />
              </div>
              <CardValue>{outboxPending}</CardValue>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500">mensagens pendentes</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/recruitment?needs=1">
          <Card className={`hover:shadow-[var(--shadow-elevated)] transition-shadow cursor-pointer ${needsMeCount > 0 ? "border-red-200" : ""}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className={needsMeCount > 0 ? "text-red-500" : ""}>Precisam de mim</CardTitle>
                <BellRing className={`w-4 h-4 ${needsMeCount > 0 ? "text-red-400" : "text-slate-400"}`} />
              </div>
              <CardValue className={needsMeCount > 0 ? "text-red-600" : ""}>{needsMeCount}</CardValue>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500">leads urgentes</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Funil */}
        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Funil de profissionais</h2>
              <Link href="/admin/recruitment" className="text-xs text-blue-600 hover:underline">
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
                    <tr key={status} className="border-t border-slate-100 first:border-0">
                      <td className="py-2.5 px-5">
                        <div className="flex items-center gap-2">
                          <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="text-sm text-slate-600">{label}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-5 text-right">
                        {count > 0 ? (
                          <span className="text-sm font-semibold text-slate-900 tabular-nums">{count}</span>
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

        {/* Bookings */}
        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Agendamentos em aberto</h2>
              <Link href="/admin/bookings" className="text-xs text-blue-600 hover:underline">
                Ver todos →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-3 px-0 pb-0">
            <table className="w-full">
              <tbody>
                {BOOKING_STAGES.map(({ status }) => {
                  const count = bookingCount(status);
                  return (
                    <tr key={status} className="border-t border-slate-100 first:border-0">
                      <td className="py-2.5 px-5">
                        <StatusBadge status={status} />
                      </td>
                      <td className="py-2.5 px-5 text-right">
                        {count > 0 ? (
                          <span className="text-sm font-semibold text-slate-900 tabular-nums">{count}</span>
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

const FUNNEL_STAGES = [
  { status: "LEAD", label: "Novos leads", icon: TrendingUp },
  { status: "PRE_CADASTRO", label: "Pré-cadastro", icon: Filter },
  { status: "TRIAGEM", label: "Triagem", icon: Clock },
  { status: "CONVERSA_PENDENTE", label: "Conversa pendente", icon: MessageSquare },
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

const BOOKING_STAGES = [
  { status: "COLLECTING_DATA", label: "Coletando dados" },
  { status: "QUOTED", label: "Cotado" },
  { status: "AWAITING_PAYMENT", label: "Aguardando pagamento" },
  { status: "PAID", label: "Pago" },
  { status: "MATCHING", label: "Buscando profissional" },
  { status: "REVIEW_REQUIRED", label: "Requer revisão" },
] as const;
