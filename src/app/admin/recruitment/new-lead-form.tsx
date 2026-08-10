"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X } from "lucide-react";
import { createLeadAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NewLeadForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phoneE164, setPhone] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    const res = await createLeadAction({
      origin: "CADASTRO_MANUAL",
      ...(fullName ? { fullName } : {}),
      ...(phoneE164 ? { phoneE164 } : {}),
      ...(neighborhood ? { neighborhood } : {}),
    });
    setPending(false);
    if (!res.ok) return setError(res.error ?? "Não foi possível criar.");
    setOpen(false);
    setFullName("");
    setPhone("");
    setNeighborhood("");
    setError(null);
    router.refresh();
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="default"
        size="sm"
        data-testid="new-lead"
        onClick={() => setOpen(true)}
      >
        <UserPlus className="w-3.5 h-3.5 mr-1.5" />
        Cadastro manual
      </Button>
    );
  }

  return (
    <form
      action={() => void submit()}
      className="flex flex-col gap-3 w-full p-3 rounded-lg border border-blue-200 bg-blue-50 sm:flex-row sm:items-end sm:flex-wrap"
    >
      <div className="flex flex-col gap-1 sm:w-auto w-full">
        <label className="text-xs font-medium text-slate-600">Nome</label>
        <Input
          aria-label="Nome"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Nome completo"
          className="w-full sm:w-48"
        />
      </div>
      <div className="flex flex-col gap-1 sm:w-auto w-full">
        <label className="text-xs font-medium text-slate-600">Telefone</label>
        <Input
          aria-label="Telefone"
          value={phoneE164}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+5585…"
          className="w-full sm:w-36"
        />
      </div>
      <div className="flex flex-col gap-1 sm:w-auto w-full">
        <label className="text-xs font-medium text-slate-600">Bairro</label>
        <Input
          aria-label="Bairro"
          value={neighborhood}
          onChange={(e) => setNeighborhood(e.target.value)}
          placeholder="Bairro"
          className="w-full sm:w-36"
        />
      </div>
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => { setOpen(false); setError(null); }}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
      {error && (
        <p role="alert" className="w-full text-xs text-red-600 mt-1">{error}</p>
      )}
    </form>
  );
}
