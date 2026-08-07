"use client";
import { DndContext, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { moveLeadAction } from "./actions";
import { LeadCard, type LeadCardData } from "./lead-card";
import type { RecruitmentStatus } from "@/domain/recruitment/recruitment-status";

export interface KanbanColumnData { status: RecruitmentStatus; label: string; leads: LeadCardData[]; }

function Column({ column }: { column: KanbanColumnData }) {
  const { setNodeRef } = useDroppable({ id: column.status });
  return (
    <section ref={setNodeRef} data-testid={`column-${column.status}`}>
      <h2>{column.label} ({column.leads.length})</h2>
      {column.leads.map((lead) => <LeadCard key={lead.id} lead={lead} />)}
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
      {error && <p role="alert" data-testid="kanban-error">{error}</p>}
      <div className="flex gap-3 overflow-x-auto">
        {columns.map((column) => <Column key={column.status} column={column} />)}
      </div>
    </DndContext>
  );
}
