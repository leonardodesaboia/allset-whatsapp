import Link from "next/link";
import { MessageSquare, Clock } from "lucide-react";
import { prisma } from "@/infrastructure/db/prisma-client";
import { CustomerConversationControls } from "./customer-conversation-controls";
import { CustomerBookingConversationState } from "@prisma/client";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";

export default async function CustomerConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const selectedState = Object.values(CustomerBookingConversationState).find(
    (value) => value === state
  );
  const conversations = await prisma.customerBookingConversation.findMany({
    where: selectedState ? { state: selectedState } : {},
    orderBy: { updatedAt: "asc" },
    include: { customer: { select: { fullName: true, phoneE164: true } } },
    take: 100,
  });

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          Conversas de clientes
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Gerencie as conversas dos clientes. Até 100 conversas por filtro.
        </p>
      </div>

      <nav
        aria-label="Filtrar por estado"
        className="flex flex-wrap gap-2 text-sm"
      >
        <Link
          href="/admin/customer-conversations"
          aria-current={!selectedState ? "page" : undefined}
          className="rounded border p-2 aria-[current=page]:ring-2"
        >
          Todos
        </Link>
        {Object.values(CustomerBookingConversationState).map((value) => (
          <Link
            key={value}
            href={`/admin/customer-conversations?state=${value}`}
            aria-current={selectedState === value ? "page" : undefined}
            className={`rounded border p-2 aria-[current=page]:ring-2 ${["PAUSED", "MANUAL_REVIEW"].includes(value) ? "border-amber-500 bg-amber-50 font-semibold" : ""}`}
          >
            {value}
          </Link>
        ))}
      </nav>
      {conversations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-400">
              Nenhuma conversa em andamento.
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
                    Etapa
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">
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
                        {conversation.customer.phoneE164}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={conversation.state} />
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Clock className="w-3 h-3 shrink-0" />
                        {conversation.updatedAt.toLocaleString("pt-BR", {
                          timeZone: "America/Fortaleza",
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
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

          {/* Mobile cards */}
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
                      {conversation.customer.phoneE164}
                    </p>
                  </div>
                  <StatusBadge status={conversation.state} />
                </div>

                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock className="w-3 h-3 shrink-0" />
                  {conversation.updatedAt.toLocaleString("pt-BR", {
                    timeZone: "America/Fortaleza",
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>

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
        </>
      )}
    </div>
  );
}
