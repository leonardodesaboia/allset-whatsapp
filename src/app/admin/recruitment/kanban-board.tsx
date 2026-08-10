"use client";

import { DndContext, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { moveLeadAction } from "./actions";
import { LeadCard, type LeadCardData } from "./lead-card";
import type { RecruitmentStatus } from "@/domain/recruitment/recruitment-status";
import { cn } from "@/lib/utils";

export interface KanbanColumnData { status: RecruitmentStatus; label: string; leads: LeadCardData[]; }

function Column({ column }: { column: KanbanColumnData }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });
  return (
    <section
      ref={setNodeRef}
      data-testid={`column-${column.status}`}
      className={cn(
        "flex flex-col min-w-[200px] w-[200px] shrink-0 rounded-lg bg-slate-50 border border-slate-200",
        isOver && "bg-blue-50 border-blue-300"
      )}
    >
      <header className="px-3 py-2.5 border-b border-slate-200">
        <div className="flex items-center justify-between gap-1">
          <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-wide leading-tight truncate">
            {column.label}
          </h2>
          {column.leads.length > 0 && (
            <span className="text-xs font-bold text-slate-400 tabular-nums shrink-0">
              {column.leads.length}
            </span>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-2 p-2 overflow-y-auto max-h-[calc(100vh-220px)]">
        {column.leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}
        {column.leads.length === 0 && (
          <p className="text-center text-xs text-slate-300 py-4">Vazio</p>
        )}
      </div>
    </section>
  );
}

export function KanbanBoard({ columns }: { columns: KanbanColumnData[] }) {
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [error, setError] = useState<string | null>(null);

  async function onDragEnd(event: DragEndEvent) {
    const targetStatus = event.over?.id as RecruitmentStatus | undefined;
    if (!targetStatus) return;
    const moved = await moveLeadAction({ leadId: String(event.active.id), targetStatus });
    if (!moved.ok) {
      setError(moved.error ?? "Movimento não permitido.");
    } else {
      setError(null);
      router.refresh();
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      {error && (
        <div role="alert" data-testid="kanban-error" className="flex items-center gap-2 mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((column) => (
          <Column key={column.status} column={column} />
        ))}
      </div>
    </DndContext>
  );
}
