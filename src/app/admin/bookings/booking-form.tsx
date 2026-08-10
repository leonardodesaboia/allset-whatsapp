"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createBookingAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

type FormValues = {
  serviceId: string;
  neighborhood: string;
  scheduledDate: string;
  scheduledTime: string;
  durationMinutes: string;
  professionalPaymentCents: string;
  customerName: string;
  customerPhone: string;
};

export function BookingForm({ services }: { services: { id: string; name: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormValues>({
    serviceId: services[0]?.id ?? "",
    neighborhood: "",
    scheduledDate: "",
    scheduledTime: "",
    durationMinutes: "180",
    professionalPaymentCents: "15000",
    customerName: "",
    customerPhone: "",
  });

  const set = (key: keyof FormValues) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: e.target.value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const result = await createBookingAction({
      ...form,
      durationMinutes: Number(form.durationMinutes),
      professionalPaymentCents: Number(form.professionalPaymentCents),
    });
    setLoading(false);
    if (!result.ok) return setError(result.error);
    router.push("/admin/bookings");
  }

  if (services.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-slate-500">
          Cadastre e ative ao menos um serviço antes de criar um agendamento.
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2 space-y-1">
          <label className="text-xs font-medium text-slate-600">Serviço</label>
          <select
            required
            value={form.serviceId}
            onChange={set("serviceId")}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Nome do cliente</label>
          <Input
            required
            value={form.customerName}
            onChange={set("customerName")}
            placeholder="Nome completo"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Telefone do cliente</label>
          <Input
            required
            placeholder="+5585…"
            value={form.customerPhone}
            onChange={set("customerPhone")}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Bairro</label>
          <Input
            required
            value={form.neighborhood}
            onChange={set("neighborhood")}
            placeholder="Ex.: Meireles"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Data</label>
          <Input
            required
            type="date"
            value={form.scheduledDate}
            onChange={set("scheduledDate")}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Horário</label>
          <Input
            required
            type="time"
            value={form.scheduledTime}
            onChange={set("scheduledTime")}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Duração (minutos)</label>
          <Input
            required
            type="number"
            min="30"
            max="720"
            value={form.durationMinutes}
            onChange={set("durationMinutes")}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Pagamento à profissional (centavos)</label>
          <Input
            required
            type="number"
            min="1"
            value={form.professionalPaymentCents}
            onChange={set("professionalPaymentCents")}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">{error}</p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={loading}>
          {loading ? "Criando…" : "Criar agendamento"}
        </Button>
      </div>
    </form>
  );
}
