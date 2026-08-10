"use client";

import { useState, type FormEvent } from "react";
import { MessageSquare, X } from "lucide-react";
import { sendManualCustomerConversationMessageAction } from "../bookings/actions";
import { Button } from "@/components/ui/button";

export function CustomerConversationMessageForm({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError(null);
    const result = await sendManualCustomerConversationMessageAction(conversationId, text);
    setSending(false);
    if (!result.ok) return setError(result.error);
    setText("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
      >
        <MessageSquare className="w-3 h-3" />
        Enviar msg
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Enviar mensagem ao cliente"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <form
        onSubmit={(e) => void submit(e)}
        className="bg-white rounded-xl shadow-xl border border-slate-200 p-5 w-96 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Mensagem para o cliente</h3>
          <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          required
          placeholder="Digite a mensagem…"
          rows={5}
          className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" type="button" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button size="sm" type="submit" disabled={sending || !text.trim()}>
            {sending ? "Enviando…" : "Enviar e pausar automação"}
          </Button>
        </div>
      </form>
    </div>
  );
}
