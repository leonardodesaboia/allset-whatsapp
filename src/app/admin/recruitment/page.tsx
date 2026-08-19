import Link from "next/link";
import { MapPin, Clock, AlertCircle } from "lucide-react";
import { getKanbanBoard, getNeedsMeLeads, searchLeads } from "@/application/recruitment/kanban-read-model";
import { prisma } from "@/infrastructure/db/prisma-client";
import { StatusBadge } from "@/components/status-badge";
import { KanbanBoard } from "./kanban-board";
import { NewLeadForm } from "./new-lead-form";
import { RecruitmentFilters } from "./recruitment-filters";

export default async function RecruitmentPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; needs?: string }>;
}) {
  const params = await searchParams;
  const needsMe = await getNeedsMeLeads(prisma);

  let content: React.ReactNode;

  if (params.needs === "1") {
    content = (
      <section>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">
          Precisa de atenção ({needsMe.length})
        </h2>
        <LeadList leads={needsMe} />
      </section>
    );
  } else if (params.q?.trim()) {
    const results = await searchLeads(prisma, params.q);
    content = (
      <section>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">
          Resultados para &ldquo;{params.q}&rdquo; ({results.length})
        </h2>
        <LeadList leads={results} />
      </section>
    );
  } else {
    const board = await getKanbanBoard(prisma);
    content = (
      <KanbanBoard
        columns={board.map((column) => ({
          status: column.status,
          label: column.label,
          leads: column.leads.map((lead) => ({
            id: lead.id,
            fullName: lead.fullName,
            neighborhood: lead.neighborhood,
            origin: lead.origin,
            nextAction: lead.nextAction,
            nextActionAt: lead.nextActionAt?.toISOString() ?? null,
            preferredCommunicationMode: lead.preferredCommunicationMode,
          })),
        }))}
      />
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Profissionais</h1>
          <p className="text-sm text-slate-500 mt-0.5">Funil de recrutamento</p>
        </div>
        <NewLeadForm />
      </div>

      <RecruitmentFilters needsMeCount={needsMe.length} />

      {content}
    </div>
  );
}

function LeadList({
  leads,
}: {
  leads: { id: string; fullName: string | null; neighborhood: string | null; status: string; nextAction: string | null; nextActionAt?: Date | null }[];
}) {
  if (leads.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm text-slate-400">Nenhum resultado.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
      {leads.map((lead) => {
        const overdue = lead.nextActionAt != null && lead.nextActionAt < new Date();
        return (
          <Link
            key={lead.id}
            href={`/admin/recruitment/${lead.id}`}
            className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition-colors group"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 group-hover:text-blue-700 truncate">
                {lead.fullName ?? <span className="text-slate-400 italic">(sem nome)</span>}
              </p>
              {lead.neighborhood && (
                <p className="flex min-w-0 items-center gap-1 text-xs text-slate-500 mt-0.5">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span className="truncate">{lead.neighborhood}</span>
                </p>
              )}
            </div>

            <StatusBadge status={lead.status} />

            {lead.nextAction && (
              <p className={`hidden sm:flex items-center gap-1 text-xs max-w-[200px] truncate ${overdue ? "text-red-600" : "text-slate-500"}`}>
                {overdue
                  ? <AlertCircle className="w-3 h-3 shrink-0" />
                  : <Clock className="w-3 h-3 shrink-0" />}
                <span className="truncate">{lead.nextAction}</span>
              </p>
            )}
          </Link>
        );
      })}
    </div>
  );
}
