import Link from "next/link";
import { MessageSquare, Clock, Search } from "lucide-react";
import { CustomerBookingConversationState, type Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/db/prisma-client";
import { CustomerConversationControls } from "./customer-conversation-controls";
import { StatusBadge, statusLabel } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime, formatPhone, formatRelative } from "@/lib/format";

const PAGE_SIZE = 25;
const NEEDS_ACTION: string[] = ["PAUSED", "MANUAL_REVIEW"];

export default async function CustomerConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const selectedState = Object.values(CustomerBookingConversationState).find(
    (value) => value === params.state
  );
  const q = params.q?.trim().slice(0, 80) ?? "";
  const digits = q.replace(/\D/g, "");
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const searchWhere: Prisma.CustomerBookingConversationWhereInput = q
    ? {
        customer: {
          OR: [
            { fullName: { contains: q, mode: "insensitive" } },
            ...(digits.length >= 3
              ? [{ phoneE164: { contains: digits } }]
              : []),
          ],
        },
      }
    : {};
  const where: Prisma.CustomerBookingConversationWhereInput = {
    ...searchWhere,
    ...(selectedState ? { state: selectedState } : {}),
  };

  const [conversations, total, stateCounts] = await Promise.all([
    prisma.customerBookingConversation.findMany({
      where,
      orderBy: { updatedAt: "asc" },
      include: {
        customer: { select: { fullName: true, phoneE164: true } },
        booking: { select: { id: true, status: true } },
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.customerBookingConversation.count({ where }),
    prisma.customerBookingConversation.groupBy({
      by: ["state"],
      where: searchWhere,
      _count: { _all: true },
    }),
  ]);

  const now = new Date();
  const countOf = (state: string) =>
    stateCounts.find((row) => row.state === state)?._count._all ?? 0;
  const allCount = stateCounts.reduce((sum, row) => sum + row._count._all, 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hrefFor = (next: { state?: string | undefined; page?: number }) => {
    const query = new URLSearchParams({
      ...(q ? { q } : {}),
      ...(next.state ? { state: next.state } : {}),
      ...(next.page && next.page > 1 ? { page: String(next.page) } : {}),
    }).toString();
    return `/admin/customer-conversations${query ? `?${query}` : ""}`;
  };

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          Conversas de clientes
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {total} conversa{total === 1 ? "" : "s"}. As mais antigas sem
          atividade aparecem primeiro.
        </p>
      </div>

      <form
        method="GET"
        action="/admin/customer-conversations"
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        {selectedState && (
          <input type="hidden" name="state" value={selectedState} />
        )}
        <label className="flex-1 text-xs font-medium text-slate-600">
          Buscar por nome ou telefone
          <span className="mt-1 flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 min-h-11">
            <Search className="w-4 h-4 text-slate-400" aria-hidden />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Ex.: Maria ou 85999…"
              className="w-full bg-transparent text-sm outline-none"
            />
          </span>
        </label>
        <div className="flex gap-2">
          <Button type="submit" size="sm" className="min-h-11 sm:min-h-0">
            Buscar
          </Button>
          {q && (
            <Link
              href={hrefFor({ state: selectedState })}
              className="inline-flex items-center min-h-11 px-3 text-sm text-slate-600 hover:underline"
            >
              Limpar
            </Link>
          )}
        </div>
      </form>

      <nav
        aria-label="Filtrar por etapa"
        className="flex flex-wrap gap-2 text-sm"
      >
        <Link
          href={hrefFor({})}
          aria-current={!selectedState ? "page" : undefined}
          className="rounded border border-slate-200 bg-white px-3 py-2 min-h-11 inline-flex items-center aria-[current=page]:ring-2 aria-[current=page]:ring-blue-500"
        >
          Todas ({allCount})
        </Link>
        {Object.values(CustomerBookingConversationState).map((value) => {
          const count = countOf(value);
          if (count === 0 && selectedState !== value) return null;
          return (
            <Link
              key={value}
              href={hrefFor({ state: value })}
              aria-current={selectedState === value ? "page" : undefined}
              className={`rounded border px-3 py-2 min-h-11 inline-flex items-center aria-[current=page]:ring-2 aria-[current=page]:ring-blue-500 ${
                NEEDS_ACTION.includes(value) && count > 0
                  ? "border-amber-500 bg-amber-50 font-semibold"
                  : "border-slate-200 bg-white"
              }`}
            >
              {statusLabel(value)} ({count})
            </Link>
          );
        })}
      </nav>

      {conversations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MessageSquare
              className="w-8 h-8 text-slate-300 mx-auto mb-2"
              aria-hidden
            />
            <p className="text-sm text-slate-400">
              {q || selectedState
                ? "Nenhuma conversa encontrada com esses filtros."
                : "Nenhuma conversa em andamento."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="hidden md:block rounded-lg border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Cliente
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Etapa
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Última atividade
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Ação
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {conversations.map((conversation) => (
                  <tr key={conversation.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/customer-conversations/${conversation.id}`}
                        className="font-semibold text-slate-900 hover:text-blue-700 leading-tight"
                      >
                        {conversation.customer.fullName}
                      </Link>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {formatPhone(conversation.customer.phoneE164)}
                      </p>
                      {conversation.booking && (
                        <Link
                          href={`/admin/bookings?status=${conversation.booking.status}`}
                          className="text-xs text-blue-700 hover:underline"
                        >
                          Pedido: {statusLabel(conversation.booking.status)}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={conversation.state} />
                    </td>
                    <td
                      className="px-4 py-3"
                      title={formatDateTime(conversation.updatedAt)}
                    >
                      <span className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Clock className="w-3 h-3 shrink-0" aria-hidden />
                        {formatRelative(conversation.updatedAt, now)}
                      </span>
                      <span className="block text-xs text-slate-400 mt-0.5">
                        {formatDateTime(conversation.updatedAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <CustomerConversationControls
                        conversationId={conversation.id}
                        version={conversation.version}
                        state={conversation.state}
                        compact
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                className="rounded-lg border border-slate-200 bg-white p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/customer-conversations/${conversation.id}`}
                      className="font-semibold text-slate-900 hover:text-blue-700 leading-tight block truncate"
                    >
                      {conversation.customer.fullName}
                    </Link>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {formatPhone(conversation.customer.phoneE164)}
                    </p>
                  </div>
                  <StatusBadge status={conversation.state} />
                </div>

                <span
                  className="flex items-center gap-1.5 text-xs text-slate-500"
                  title={formatDateTime(conversation.updatedAt)}
                >
                  <Clock className="w-3 h-3 shrink-0" aria-hidden />
                  {formatRelative(conversation.updatedAt, now)} ·{" "}
                  {formatDateTime(conversation.updatedAt)}
                </span>

                {conversation.booking && (
                  <Link
                    href={`/admin/bookings?status=${conversation.booking.status}`}
                    className="block text-xs text-blue-700 hover:underline"
                  >
                    Pedido: {statusLabel(conversation.booking.status)}
                  </Link>
                )}

                <div className="pt-1 border-t border-slate-100">
                  <CustomerConversationControls
                    conversationId={conversation.id}
                    version={conversation.version}
                    state={conversation.state}
                    compact
                  />
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <nav
              aria-label="Paginação"
              className="flex items-center justify-between text-sm"
            >
              {page > 1 ? (
                <Link
                  href={hrefFor({ state: selectedState, page: page - 1 })}
                  className="text-blue-700 hover:underline"
                >
                  ← Anterior
                </Link>
              ) : (
                <span />
              )}
              <span className="text-slate-500">
                Página {page} de {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  href={hrefFor({ state: selectedState, page: page + 1 })}
                  className="text-blue-700 hover:underline"
                >
                  Próxima →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
