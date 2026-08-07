"use client";

import { useState, type FormEvent } from "react";
import { sendManualCustomerMessageAction } from "./actions";

export function CustomerMessageForm({ bookingId }: { bookingId: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError(null);
    const result = await sendManualCustomerMessageAction(bookingId, text);
    setSending(false);
    if (!result.ok) return setError(result.error);
    setText("");
  }

  return <form onSubmit={(event) => void submit(event)}>
    <label>
      Mensagem para o cliente
      <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} required />
    </label>
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={sending}>{sending ? "Enviando..." : "Enviar e pausar automação"}</button>
  </form>;
}
