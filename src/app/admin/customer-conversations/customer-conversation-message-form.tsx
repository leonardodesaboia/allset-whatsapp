"use client";

import { useState, type FormEvent } from "react";
import { sendManualCustomerConversationMessageAction } from "../bookings/actions";

export function CustomerConversationMessageForm({ conversationId }: { conversationId: string }) {
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
  }

  return <form onSubmit={(event) => void submit(event)}>
    <label>Mensagem para o cliente<textarea required maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={sending}>{sending ? "Enviando..." : "Enviar e pausar automação"}</button>
  </form>;
}
