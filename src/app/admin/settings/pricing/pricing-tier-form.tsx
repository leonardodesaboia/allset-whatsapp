"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { createPricingTierAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
    try {
      const result = await createPricingTierAction({
        label,
        description,
        priceCents: Math.round(Number(price) * 100),
        durationMinutes: Number(duration),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLabel("");
      setDescription("");
      setPrice("");
    } catch {
      setError("Não foi possível salvar a faixa de preço. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="rounded-lg border border-slate-200 bg-white p-5 space-y-4"
    >
      <h2 className="text-sm font-semibold text-slate-900">Nova faixa de preço</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Nome da opção</label>
          <Input
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex.: Apartamento de 1 quarto"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Preço para o cliente (R$)</label>
          <Input
            required
            type="number"
            min="0.01"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="250.00"
          />
        </div>

        <div className="sm:col-span-2 space-y-1">
          <label className="text-xs font-medium text-slate-600">Características</label>
          <textarea
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex.: até 60 m², 1 quarto e 1 banheiro"
            rows={2}
            className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Duração prevista (minutos)</label>
          <Input
            required
            type="number"
            min="30"
            max="720"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
      </div>

      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={saving}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          {saving ? "Salvando…" : "Adicionar faixa"}
        </Button>
      </div>
    </form>
  );
}
