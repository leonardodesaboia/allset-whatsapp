import Link from "next/link";
import { MessageSquare, Clock } from "lucide-react";
import { prisma } from "@/infrastructure/db/prisma-client";
import { CustomerConversationMessageForm } from "./customer-conversation-message-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export default async function CustomerConversationsPage() {
  const conversations = await prisma.customerBookingConversation.findMany({
    where: { bookingId: null, state: { not: "COMPLETED" } },
    orderBy: { updatedAt: "asc" },
    include: { customer: { select: { fullName: true, phoneE164: true } } },
    take: 100,
  });

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Conversas de clientes</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Conversas sem pedido em andamento — converse manualmente ou pause a automação.
        </p>
      </div>

      {conversations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-400">Nenhuma conversa em andamento.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Cliente</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Etapa</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Última atividade</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Ação</th>
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
                      <p className="text-xs text-slate-500 mt-0.5">{conversation.customer.phoneE164}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{conversation.state}</Badge>
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
                      <CustomerConversationMessageForm conversationId={conversation.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {conversations.map((conversation) => (
              <div key={conversation.id} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/customer-conversations/${conversation.id}`}
                      className="font-semibold text-slate-900 hover:text-blue-700 leading-tight block truncate"
                    >
                      {conversation.customer.fullName}
                    </Link>
                    <p className="text-xs text-slate-500 mt-0.5">{conversation.customer.phoneE164}</p>
                  </div>
                  <Badge variant="secondary">{conversation.state}</Badge>
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
                  <CustomerConversationMessageForm conversationId={conversation.id} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
