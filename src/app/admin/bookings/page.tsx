import Link from "next/link";
import { Plus, Clock, CheckCircle2, ArrowRight } from "lucide-react";
import { prisma } from "@/infrastructure/db/prisma-client";
import { dispatchOpportunityAction, resumeCustomerAutomationAction, validateBookingCoverageAction } from "./actions";
import { CustomerMessageForm } from "./customer-message-form";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const formatDateTime = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Fortaleza",
  }).format(date);

export default async function BookingsPage() {
  const bookings = await prisma.booking.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      service: { select: { name: true } },
      customer: { select: { fullName: true, phoneE164: true } },
      customerConversation: { select: { id: true, state: true } },
      opportunities: { select: { id: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Agendamentos</h1>
          <p className="text-sm text-slate-500 mt-0.5">Últimos 50</p>
        </div>
        <Link href="/admin/bookings/new">
          <Button size="sm">
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Novo agendamento
          </Button>
        </Link>
      </div>

      {bookings.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-slate-400">Nenhum agendamento criado.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Cliente</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Serviço</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Bairro</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Data</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bookings.map((booking) => {
                const opportunity = booking.opportunities[0];
                return (
                  <tr key={booking.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900 leading-tight">{booking.customer.fullName}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{booking.customer.phoneE164}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{booking.service.name}</td>
                    <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{booking.neighborhood ?? "—"}</td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {booking.scheduledAt ? (
                        <span className="flex items-center gap-1 text-slate-600">
                          <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                          {formatDateTime(booking.scheduledAt)}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={booking.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1.5">
                        {booking.status === "DRAFT" && (
                          <form action={async () => {
                            "use server";
                            await dispatchOpportunityAction(booking.id);
                          }}>
                            <button
                              type="submit"
                              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
                            >
                              <ArrowRight className="w-3 h-3" />
                              Enviar para matching
                            </button>
                          </form>
                        )}

                        {booking.status === "REVIEW_REQUIRED" && booking.customerConversation && booking.addressLine1 && (
                          <div className="space-y-1">
                            <p className="text-xs text-slate-600">{booking.addressLine1}</p>
                            <div className="flex gap-2 flex-wrap">
                              <form action={async () => { "use server"; await validateBookingCoverageAction(booking.id, true); }}>
                                <button type="submit" className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900">
                                  <CheckCircle2 className="w-3 h-3" /> Atendido
                                </button>
                              </form>
                              <form action={async () => { "use server"; await validateBookingCoverageAction(booking.id, false); }}>
                                <button type="submit" className="text-xs font-medium text-amber-700 hover:text-amber-900">
                                  Lista de espera
                                </button>
                              </form>
                            </div>
                          </div>
                        )}

                        {booking.customerConversation?.state === "PAUSED" && (
                          <form action={async () => { "use server"; await resumeCustomerAutomationAction(booking.id); }}>
                            <button type="submit" className="text-xs font-medium text-slate-600 hover:text-slate-900">
                              Retomar automação
                            </button>
                          </form>
                        )}

                        {opportunity && (
                          <Link
                            href={`/admin/bookings/${booking.id}/opportunity`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-purple-700 hover:text-purple-900"
                          >
                            <ArrowRight className="w-3 h-3" />
                            Oportunidade ({opportunity.status})
                          </Link>
                        )}

                        {booking.customerConversation && (
                          <CustomerMessageForm bookingId={booking.id} />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
