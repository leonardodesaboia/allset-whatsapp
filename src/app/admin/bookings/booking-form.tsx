"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createBookingAction } from "./actions";

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
    serviceId: services[0]?.id ?? "", neighborhood: "", scheduledDate: "", scheduledTime: "",
    durationMinutes: "180", professionalPaymentCents: "15000", customerName: "", customerPhone: "",
  });
  const set = (key: keyof FormValues) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

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

  if (services.length === 0) return <p>Cadastre e ative ao menos um serviço antes de criar um agendamento.</p>;
  return <form onSubmit={(event) => void submit(event)}>
    <label>Serviço<select required value={form.serviceId} onChange={set("serviceId")}>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
    <label>Nome do cliente<input required value={form.customerName} onChange={set("customerName")} /></label>
    <label>Telefone do cliente<input required placeholder="+5585..." value={form.customerPhone} onChange={set("customerPhone")} /></label>
    <label>Bairro<input required value={form.neighborhood} onChange={set("neighborhood")} /></label>
    <label>Data<input required type="date" value={form.scheduledDate} onChange={set("scheduledDate")} /></label>
    <label>Horário<input required type="time" value={form.scheduledTime} onChange={set("scheduledTime")} /></label>
    <label>Duração (minutos)<input required type="number" min="30" max="720" value={form.durationMinutes} onChange={set("durationMinutes")} /></label>
    <label>Pagamento à profissional (centavos)<input required type="number" min="1" value={form.professionalPaymentCents} onChange={set("professionalPaymentCents")} /></label>
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={loading}>{loading ? "Criando..." : "Criar agendamento"}</button>
  </form>;
}
