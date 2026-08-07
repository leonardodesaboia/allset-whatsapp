"use client";

import { useState, type FormEvent } from "react";
import { createPricingTierAction } from "./actions";

export function PricingTierForm() {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("180");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const result = await createPricingTierAction({ label, description, priceCents: Math.round(Number(price) * 100), durationMinutes: Number(duration) });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    setLabel("");
    setDescription("");
    setPrice("");
  }

  return <form onSubmit={(event) => void submit(event)}>
    <label>Nome da opção<input required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: Apartamento de 1 quarto" /></label>
    <label>Características<textarea required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: até 60 m², 1 quarto e 1 banheiro" /></label>
    <label>Preço para o cliente (R$)<input required type="number" min="0.01" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
    <label>Duração prevista (minutos)<input required type="number" min="30" max="720" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={saving}>{saving ? "Salvando..." : "Adicionar faixa"}</button>
  </form>;
}
