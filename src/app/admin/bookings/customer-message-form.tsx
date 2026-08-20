"use client";

import { useState, type FormEvent } from "react";
import { MessageSquare, X } from "lucide-react";
import { sendManualCustomerMessageAction } from "./actions";
import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";

export function CustomerMessageForm({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const result = await sendManualCustomerMessageAction(bookingId, text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setText("");
      setOpen(false);
    } catch {
      setError("Não foi possível enviar a mensagem. Tente novamente.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
      >
        <MessageSquare className="w-3 h-3" />
        Enviar msg
      </button>
      {open && (
        <ModalDialog
          ariaLabel="Enviar mensagem ao cliente"
          onClose={() => setOpen(false)}
        >
          <form
            onSubmit={(e) => void submit(e)}
            className="w-full max-w-96 space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Mensagem para o cliente
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-700"
                aria-label="Fechar mensagem ao cliente"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <textarea
              value={text}
              autoFocus
              data-autofocus
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
              required
              placeholder="Digite a mensagem…"
              rows={5}
              className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}

            <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:justify-end">
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
                type="submit"
                disabled={sending || !text.trim()}
              >
                {sending ? "Enviando…" : "Enviar e pausar automação"}
              </Button>
            </div>
          </form>
        </ModalDialog>
      )}
    </>
  );
}
