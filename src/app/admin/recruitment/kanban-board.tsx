"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { moveLeadAction } from "./actions";
import { LeadCard, type LeadCardData } from "./lead-card";
import type { RecruitmentStatus } from "@/domain/recruitment/recruitment-status";
import { cn } from "@/lib/utils";

export interface KanbanColumnData {
  status: RecruitmentStatus;
  label: string;
  leads: LeadCardData[];
}

const kanbanKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context, currentCoordinates }
) => {
  if (event.code !== "ArrowLeft" && event.code !== "ArrowRight")
    return undefined;
  const activeRect = context.collisionRect;
  if (!activeRect) return undefined;

  const direction = event.code === "ArrowRight" ? 1 : -1;
  const activeCenterX = activeRect.left + activeRect.width / 2;
  const activeCenterY = activeRect.top + activeRect.height / 2;
  const currentDroppableId = context.over?.id;
  const candidates = context.droppableContainers
    .getEnabled()
    .flatMap((container) => {
      if (container.id === currentDroppableId) return [];
      const rect = context.droppableRects.get(container.id);
      if (!rect) return [];
      const containsActive =
        activeCenterX >= rect.left &&
        activeCenterX <= rect.right &&
        activeCenterY >= rect.top &&
        activeCenterY <= rect.bottom;
      if (containsActive) return [];
      const centerX = rect.left + rect.width / 2;
      return direction * (centerX - activeCenterX) > 1
        ? [{ rect, distance: Math.abs(centerX - activeCenterX) }]
        : [];
    });
  const target = candidates.sort((a, b) => a.distance - b.distance)[0]?.rect;
  if (!target) return undefined;

  event.preventDefault();
  return {
    x: currentCoordinates.x + target.left + target.width / 2 - activeCenterX,
    y:
      currentCoordinates.y +
      target.top +
      target.height / 2 -
      (activeRect.top + activeRect.height / 2),
  };
};

function Column({ column }: { column: KanbanColumnData }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });
  const isEmpty = column.leads.length === 0;

  if (isEmpty) {
    return (
      <section
        ref={setNodeRef}
        data-testid={`column-${column.status}`}
        aria-label={`Etapa ${column.label}, sem profissionais`}
        className={cn(
          "flex min-w-[128px] w-[128px] shrink-0 flex-col rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3",
          isOver && "bg-blue-50 border-blue-300"
        )}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{column.label}</h2>
        <p className="mt-1 text-xs text-slate-600">Nenhuma profissional</p>
      </section>
    );
  }

  return (
    <section
      ref={setNodeRef}
      data-testid={`column-${column.status}`}
      aria-label={`Etapa ${column.label}, ${column.leads.length} profissionais`}
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
          <span className="text-xs font-bold text-slate-400 tabular-nums shrink-0">
            {column.leads.length}
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-2 p-2 overflow-y-auto max-h-[calc(100vh-220px)]">
        {column.leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}
      </div>
    </section>
  );
}

export function KanbanBoard({ columns }: { columns: KanbanColumnData[] }) {
  const router = useRouter();
  const keyboardColumnOffsetRef = useRef(0);
  const keyboardCoordinates = useCallback<KeyboardCoordinateGetter>(
    (event, args) => {
      if (event.code === "ArrowLeft") keyboardColumnOffsetRef.current -= 1;
      if (event.code === "ArrowRight") keyboardColumnOffsetRef.current += 1;
      return kanbanKeyboardCoordinates(event, args);
    },
    []
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates })
  );
  const [error, setError] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  async function onDragEnd(event: DragEndEvent) {
    if (isMoving) return;
    let targetStatus = event.over?.id as RecruitmentStatus | undefined;
    if (keyboardColumnOffsetRef.current !== 0) {
      const sourceColumnIndex = columns.findIndex((column) =>
        column.leads.some((lead) => lead.id === String(event.active.id))
      );
      targetStatus = columns[sourceColumnIndex + keyboardColumnOffsetRef.current]?.status;
    }
    keyboardColumnOffsetRef.current = 0;
    if (!targetStatus) return;
    const sourceStatus = columns.find((column) =>
      column.leads.some((lead) => lead.id === String(event.active.id))
    )?.status;
    if (!sourceStatus || sourceStatus === targetStatus) return;
    const targetLabel = columns.find((column) => column.status === targetStatus)?.label ?? "a nova etapa";
    const requiresConfirmation = ["ATIVA", "PREFERENCIAL", "REPROVADA", "DESISTIU", "SUSPENSA"].includes(targetStatus);
    if (requiresConfirmation && !window.confirm(`Mover a profissional para “${targetLabel}”? Esta mudança pode exigir uma nova avaliação para ser revertida.`)) return;
    setIsMoving(true);
    try {
      const moved = await moveLeadAction({
        leadId: String(event.active.id),
        targetStatus,
      });
      if (!moved.ok) {
        setError(moved.error ?? "Movimento não permitido.");
        return;
      }
      setError(null);
      router.refresh();
    } catch {
      setError("Não foi possível mover a profissional. Tente novamente.");
    } finally {
      setIsMoving(false);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={() => {
        keyboardColumnOffsetRef.current = 0;
      }}
      onDragCancel={() => {
        keyboardColumnOffsetRef.current = 0;
      }}
      onDragEnd={onDragEnd}
    >
      {error && (
        <div
          role="alert"
          data-testid="kanban-error"
          className="flex items-center gap-2 mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
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
