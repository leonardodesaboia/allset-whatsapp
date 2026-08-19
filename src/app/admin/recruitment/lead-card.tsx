"use client";

import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { MapPin, Clock, AlertCircle, Mic, ExternalLink } from "lucide-react";
import { QuickNoteModal } from "./quick-note-modal";
import { cn } from "@/lib/utils";

export interface LeadCardData {
  id: string;
  fullName: string | null;
  neighborhood: string | null;
  origin: string;
  nextAction: string | null;
  nextActionAt: string | null;
  preferredCommunicationMode: string | null;
}

export function LeadCard({ lead }: { lead: LeadCardData }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const overdue = lead.nextActionAt !== null && new Date(lead.nextActionAt) < new Date();

  return (
    <article
      ref={setNodeRef}
      style={{ transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined }}
      data-testid={`card-${lead.id}`}
      className={cn(
        "bg-white rounded-md border border-slate-200 p-3 shadow-sm select-none",
        isDragging && "opacity-50 shadow-lg ring-2 ring-blue-400",
        overdue && "border-l-2 border-l-red-400"
      )}
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
        <p className="text-sm font-semibold text-slate-900 leading-tight mb-1.5">
          {lead.fullName ?? <span className="text-slate-400 italic">(sem nome)</span>}
        </p>

        {lead.neighborhood && (
          <p className="flex items-center gap-1 text-xs text-slate-500 mb-1">
            <MapPin className="w-3 h-3 shrink-0" />
            {lead.neighborhood}
          </p>
        )}

        {lead.preferredCommunicationMode === "AUDIO" && (
          <p className="flex items-center gap-1 text-xs text-slate-400 mb-1">
            <Mic className="w-3 h-3 shrink-0" />
            Prefere áudio
          </p>
        )}

        {lead.nextAction && (
          <p className={cn(
            "flex items-start gap-1 text-xs mt-1.5 rounded px-1.5 py-1",
            overdue
              ? "bg-red-50 text-red-700"
              : "bg-slate-50 text-slate-600"
          )}>
            {overdue
              ? <AlertCircle className="w-3 h-3 shrink-0 mt-px" />
              : <Clock className="w-3 h-3 shrink-0 mt-px" />}
            <span className="leading-tight">{lead.nextAction}</span>
          </p>
        )}
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
        <QuickNoteModal leadId={lead.id} />
        <Link
          href={`/admin/recruitment/${lead.id}`}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
        >
          Abrir
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
    </article>
  );
}
