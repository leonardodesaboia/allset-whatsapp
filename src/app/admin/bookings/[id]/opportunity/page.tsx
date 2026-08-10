import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock } from "lucide-react";
import { prisma } from "@/infrastructure/db/prisma-client";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const formatDateTime = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Fortaleza",
  }).format(date);

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      opportunities: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          responses: {
            orderBy: { sentAt: "asc" },
            include: { lead: { select: { fullName: true, phoneE164: true, neighborhood: true } } },
          },
        },
      },
    },
  });
  if (!booking) notFound();
  const opportunity = booking.opportunities[0];

  return (
    <div className="p-6 max-w-3xl space-y-5">
      <Link
        href="/admin/bookings"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Agendamentos
      </Link>

      <div>
        <h1 className="text-xl font-bold text-slate-900">Oportunidade</h1>
        <div className="flex items-center gap-2 mt-1.5">
          <StatusBadge status={booking.status} />
        </div>
      </div>

      {!opportunity ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-slate-400">Nenhuma oportunidade foi enviada ainda.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Respostas</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant={opportunity.status === "FILLED" ? "success" : opportunity.status === "EXPIRED" || opportunity.status === "CANCELLED" ? "destructive" : "secondary"}>
                  {opportunity.status}
                </Badge>
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <Clock className="w-3 h-3" />
                  Expira {formatDateTime(opportunity.expiresAt)}
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-500">Bairro: {opportunity.neighborhood}</p>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Profissional</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Bairro</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Enviado</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Resposta</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Respondido em</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {opportunity.responses.map((response) => (
                  <tr key={response.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-slate-900 leading-tight">{response.lead.fullName ?? "—"}</p>
                      <p className="text-xs text-slate-500">{response.lead.phoneE164 ?? "—"}</p>
                    </td>
                    <td className="px-5 py-3 text-slate-500 hidden md:table-cell">{response.lead.neighborhood ?? "—"}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{formatDateTime(response.sentAt)}</td>
                    <td className="px-5 py-3">
                      {response.response ? (
                        <Badge variant={response.response === "ACCEPTED" ? "success" : response.response === "DECLINED" ? "destructive" : "secondary"}>
                          {response.response}
                        </Badge>
                      ) : (
                        <Badge variant="outline">Aguardando</Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500 hidden lg:table-cell">
                      {response.respondedAt ? formatDateTime(response.respondedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
