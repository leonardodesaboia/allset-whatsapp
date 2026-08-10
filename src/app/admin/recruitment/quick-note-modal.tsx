"use client";

import { useState } from "react";
import { MessageSquarePlus, X } from "lucide-react";
import { addQuickNoteAction } from "./actions";
import { Button } from "@/components/ui/button";

export function QuickNoteModal({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const res = await addQuickNoteAction({ leadId, content });
    if (!res.ok) return setError(res.error ?? "Não foi possível salvar.");
    setContent("");
    setOpen(false);
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid={`quick-note-${leadId}`}
        className="h-6 px-1.5 text-xs text-slate-400 hover:text-slate-700"
      >
        <MessageSquarePlus className="w-3 h-3 mr-1" />
        Nota
      </Button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Nota interna"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-5 w-80 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Nota interna</h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-slate-400 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <textarea
          aria-label="Escrever nota interna"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Escreva a nota…"
          rows={4}
          className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="sm" type="button" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button size="sm" type="button" onClick={() => void save()} disabled={!content.trim()}>
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}
