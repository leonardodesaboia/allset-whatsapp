"use client";

import { useState } from "react";
import { MessageSquarePlus, X } from "lucide-react";
import { addQuickNoteAction } from "./actions";
import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";

export function QuickNoteModal({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await addQuickNoteAction({ leadId, content });
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar.");
        return;
      }
      setContent("");
      setOpen(false);
    } catch {
      setError("Não foi possível salvar a nota. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid={`quick-note-${leadId}`}
        className="h-6 px-1.5 text-xs text-slate-400 hover:text-slate-700"
      >
        <MessageSquarePlus className="w-3 h-3 mr-1" />
        Nota
      </Button>
      {open && (
        <ModalDialog ariaLabel="Nota interna" onClose={() => setOpen(false)}>
          <div className="w-full max-w-80 space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Nota interna
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-700"
                aria-label="Fechar nota interna"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <textarea
              aria-label="Escrever nota interna"
              value={content}
              autoFocus
              data-autofocus
              onChange={(e) => setContent(e.target.value)}
              placeholder="Escreva a nota…"
              rows={4}
              maxLength={1000}
              className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-right text-[10px] text-slate-400 -mt-2">{content.length}/1000</p>

            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}

            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                type="button"
                onClick={() => void save()}
                disabled={saving || !content.trim()}
              >
                {saving ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </div>
        </ModalDialog>
      )}
    </>
  );
}
