import Link from "next/link";
import { Plus, Clock, CheckCircle2, ArrowRight, Search } from "lucide-react";
import { BookingStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/db/prisma-client";
import {
  advanceBookingStatusAction,
  confirmManualPaymentAction,
  resumeCustomerAutomationAction,
  validateBookingCoverageAction,
} from "./actions";
import { BookingMatchingActions } from "./booking-matching-actions";
import { CustomerMessageForm } from "./customer-message-form";
import { StatusBadge, statusLabel } from "@/components/status-badge";
import { formatBRL, formatPhone, formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ActionFeedbackForm } from "@/components/ui/action-feedback-form";
import { ConfirmButton } from "@/components/ui/confirm-button";

const formatDateTime = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Fortaleza",
  }).format(date);

const NEXT_STEP_LABEL: Record<string, string> = {
  PROFESSIONAL_ASSIGNED: "Marcar como agendado",
  SCHEDULED: "Profissional confirmou",
  PROFESSIONAL_CONFIRMED: "Profissional a caminho",
  PROFESSIONAL_EN_ROUTE: "Atendimento iniciado",
  IN_PROGRESS: "Atendimento concluído",
  AWAITING_COMPLETION_CONFIRMATION: "Confirmar conclusão",
};

const PAGE_SIZE = 25;

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 80) ?? "";
  const status = Object.values(BookingStatus).find((value) => value === params.status);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const digits = q.replace(/\D/g, "");

  const where: Prisma.BookingWhereInput = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { customer: { fullName: { contains: q, mode: "insensitive" } } },
            ...(digits.length >= 3 ? [{ customer: { phoneE164: { contains: digits } } }] : []),
            { neighborhood: { contains: q, mode: "insensitive" } },
            { addressLine1: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        service: { select: { name: true } },
        customer: { select: { fullName: true, phoneE164: true } },
        assignedProfessionalLead: { select: { id: true, fullName: true } },
        customerConversation: {
          select: { id: true, state: true, lastQuestionKey: true },
        },
        opportunities: {
          select: { id: true, status: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  const now = new Date();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (target: number) =>
    `/admin/bookings?${new URLSearchParams({
      ...(q ? { q } : {}),
      ...(status ? { status } : {}),
      page: String(target),
    }).toString()}`;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Agendamentos</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {total} pedido{total === 1 ? "" : "s"}
            {status || q ? " encontrados" : ""}
          </p>
        </div>
        <Link href="/admin/bookings/new">
          <Button size="sm">
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Novo agendamento
          </Button>
        </Link>
      </div>

      <form method="GET" action="/admin/bookings" className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1 text-xs font-medium text-slate-600">
          Buscar por nome, telefone, bairro ou endereço
          <span className="mt-1 flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 min-h-11">
            <Search className="w-4 h-4 text-slate-400" aria-hidden />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Ex.: Maria, 85999…, Aldeota"
              className="w-full bg-transparent text-sm outline-none"
            />
          </span>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Situação
          <select
            name="status"
            defaultValue={status ?? ""}
            className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
          >
            <option value="">Todas</option>
            {Object.values(BookingStatus).map((value) => (
              <option key={value} value={value}>
                {statusLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <Button type="submit" size="sm" className="min-h-11 sm:min-h-0">Filtrar</Button>
          {(q || status) && (
            <Link href="/admin/bookings" className="inline-flex items-center min-h-11 px-3 text-sm text-slate-600 hover:underline">
              Limpar
            </Link>
          )}
        </div>
      </form>

      {bookings.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-slate-400">
              {q || status ? "Nenhum pedido encontrado com esses filtros." : "Nenhum agendamento criado."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Cliente
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Serviço
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">
                    Bairro
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">
                    Data
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bookings.map((booking) => {
                  const opportunity = booking.opportunities[0];
                  return (
                    <tr key={booking.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900 leading-tight">
                          {booking.customer.fullName}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatPhone(booking.customer.phoneE164)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {booking.service.name}
                        {booking.totalCents > 0 && (
                          <p className="text-xs text-slate-500 mt-0.5">{formatBRL(booking.totalCents)}</p>
                        )}
                        {booking.assignedProfessionalLead && (
                          <Link
                            href={`/admin/recruitment/${booking.assignedProfessionalLead.id}`}
                            className="block text-xs text-blue-700 hover:underline mt-0.5"
                          >
                            Prof.: {booking.assignedProfessionalLead.fullName}
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                        {booking.neighborhood ?? "—"}
                      </td>
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
                        <p className="text-xs text-slate-400 mt-1">atualizado {formatRelative(booking.updatedAt, now)}</p>
                        {booking.customerConversation && (
                          <Link
                            href={`/admin/customer-conversations/${booking.customerConversation.id}`}
                            className="block text-xs text-blue-700 hover:underline mt-0.5"
                          >
                            Ver conversa
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1.5">
                          {(booking.status === "DRAFT" ||
                            booking.status === "PAID" ||
                            (booking.status === "REVIEW_REQUIRED" &&
                              opportunity?.status === "EXPIRED")) && (
                            <BookingMatchingActions
                              bookingId={booking.id}
                              neighborhood={booking.neighborhood}
                              professionalPaymentCents={
                                booking.professionalPaymentCents
                              }
                              address={booking.addressLine1}
                              expired={opportunity?.status === "EXPIRED"}
                            />
                          )}

                          {booking.status === "AWAITING_PAYMENT" && (
                            <ActionFeedbackForm
                              action={async () => {
                                "use server";
                                return confirmManualPaymentAction(booking.id);
                              }}
                            >
                              <ConfirmButton
                                message="Confirmar o pagamento manual? Esta ação registra o pedido como pago. Depois, informe bairro e repasse para enviar a oportunidade."
                                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900"
                              >
                                <CheckCircle2 className="w-3 h-3" /> Confirmar
                                pagamento manual
                              </ConfirmButton>
                            </ActionFeedbackForm>
                          )}

                          {booking.status === "REVIEW_REQUIRED" &&
                            booking.customerConversation?.lastQuestionKey ===
                              "MANUAL_REVIEW" &&
                            booking.addressLine1 && (
                              <div className="space-y-1">
                                <p className="text-xs text-slate-600">
                                  {booking.addressLine1}
                                </p>
                                <div className="flex gap-2 flex-wrap">
                                  <ActionFeedbackForm
                                    action={async () => {
                                      "use server";
                                      return validateBookingCoverageAction(
                                        booking.id,
                                        true
                                      );
                                    }}
                                  >
                                    <button
                                      type="submit"
                                      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900"
                                    >
                                      <CheckCircle2 className="w-3 h-3" />{" "}
                                      Atendido
                                    </button>
                                  </ActionFeedbackForm>
                                  <ActionFeedbackForm
                                    action={async () => {
                                      "use server";
                                      return validateBookingCoverageAction(
                                        booking.id,
                                        false
                                      );
                                    }}
                                  >
                                    <button
                                      type="submit"
                                      className="text-xs font-medium text-amber-700 hover:text-amber-900"
                                    >
                                      Lista de espera
                                    </button>
                                  </ActionFeedbackForm>
                                </div>
                              </div>
                            )}

                          {booking.customerConversation?.state === "PAUSED" && (
                            <ActionFeedbackForm
                              action={async () => {
                                "use server";
                                return resumeCustomerAutomationAction(
                                  booking.id
                                );
                              }}
                            >
                              <button
                                type="submit"
                                className="text-xs font-medium text-slate-600 hover:text-slate-900"
                              >
                                Retomar automação
                              </button>
                            </ActionFeedbackForm>
                          )}

                          {NEXT_STEP_LABEL[booking.status] && (
                            <ActionFeedbackForm
                              action={async () => {
                                "use server";
                                return advanceBookingStatusAction(booking.id);
                              }}
                            >
                              <button
                                type="submit"
                                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
                              >
                                <ArrowRight className="w-3 h-3" />{" "}
                                {NEXT_STEP_LABEL[booking.status]}
                              </button>
                            </ActionFeedbackForm>
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

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {bookings.map((booking) => {
              const opportunity = booking.opportunities[0];
              return (
                <div
                  key={booking.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 leading-tight truncate">
                        {booking.customer.fullName}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {formatPhone(booking.customer.phoneE164)}
                      </p>
                    </div>
                    <StatusBadge status={booking.status} />
                  </div>

                  <div className="space-y-1 text-sm text-slate-600">
                    <p>
                      {booking.service.name}
                      {booking.totalCents > 0 && ` · ${formatBRL(booking.totalCents)}`}
                    </p>
                    <p className="text-xs text-slate-400">atualizado {formatRelative(booking.updatedAt, now)}</p>
                    {booking.customerConversation && (
                      <Link
                        href={`/admin/customer-conversations/${booking.customerConversation.id}`}
                        className="block text-xs text-blue-700 hover:underline"
                      >
                        Ver conversa
                      </Link>
                    )}
                    {booking.assignedProfessionalLead && (
                      <Link
                        href={`/admin/recruitment/${booking.assignedProfessionalLead.id}`}
                        className="block text-xs text-blue-700 hover:underline"
                      >
                        Prof.: {booking.assignedProfessionalLead.fullName}
                      </Link>
                    )}
                    {booking.neighborhood && (
                      <p className="text-xs text-slate-500">
                        {booking.neighborhood}
                      </p>
                    )}
                    {booking.scheduledAt && (
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                        {formatDateTime(booking.scheduledAt)}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 pt-1 border-t border-slate-100">
                    {(booking.status === "DRAFT" ||
                      booking.status === "PAID" ||
                      (booking.status === "REVIEW_REQUIRED" &&
                        opportunity?.status === "EXPIRED")) && (
                      <BookingMatchingActions
                        bookingId={booking.id}
                        neighborhood={booking.neighborhood}
                        professionalPaymentCents={
                          booking.professionalPaymentCents
                        }
                        address={booking.addressLine1}
                        expired={opportunity?.status === "EXPIRED"}
                      />
                    )}

                    {booking.status === "AWAITING_PAYMENT" && (
                      <ActionFeedbackForm
                        action={async () => {
                          "use server";
                          return confirmManualPaymentAction(booking.id);
                        }}
                      >
                        <ConfirmButton
                          message="Confirmar o pagamento manual? Esta ação registra o pedido como pago. Depois, informe bairro e repasse para enviar a oportunidade."
                          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Confirmar
                          pagamento manual
                        </ConfirmButton>
                      </ActionFeedbackForm>
                    )}

                    {booking.status === "REVIEW_REQUIRED" &&
                      booking.customerConversation?.lastQuestionKey ===
                        "MANUAL_REVIEW" &&
                      booking.addressLine1 && (
                        <div className="space-y-1">
                          <p className="text-xs text-slate-600">
                            {booking.addressLine1}
                          </p>
                          <div className="flex gap-3 flex-wrap">
                            <ActionFeedbackForm
                              action={async () => {
                                "use server";
                                return validateBookingCoverageAction(
                                  booking.id,
                                  true
                                );
                              }}
                            >
                              <button
                                type="submit"
                                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900"
                              >
                                <CheckCircle2 className="w-3 h-3" /> Atendido
                              </button>
                            </ActionFeedbackForm>
                            <ActionFeedbackForm
                              action={async () => {
                                "use server";
                                return validateBookingCoverageAction(
                                  booking.id,
                                  false
                                );
                              }}
                            >
                              <button
                                type="submit"
                                className="text-xs font-medium text-amber-700 hover:text-amber-900"
                              >
                                Lista de espera
                              </button>
                            </ActionFeedbackForm>
                          </div>
                        </div>
                      )}

                    {booking.customerConversation?.state === "PAUSED" && (
                      <ActionFeedbackForm
                        action={async () => {
                          "use server";
                          return resumeCustomerAutomationAction(booking.id);
                        }}
                      >
                        <button
                          type="submit"
                          className="text-xs font-medium text-slate-600 hover:text-slate-900"
                        >
                          Retomar automação
                        </button>
                      </ActionFeedbackForm>
                    )}

                    {NEXT_STEP_LABEL[booking.status] && (
                      <ActionFeedbackForm
                        action={async () => {
                          "use server";
                          return advanceBookingStatusAction(booking.id);
                        }}
                      >
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
                        >
                          <ArrowRight className="w-3 h-3" />{" "}
                          {NEXT_STEP_LABEL[booking.status]}
                        </button>
                      </ActionFeedbackForm>
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
                </div>
              );
            })}
          </div>
        </>
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
