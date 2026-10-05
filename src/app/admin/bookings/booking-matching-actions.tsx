"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { dispatchOpportunityAction, prepareBookingMatchingAction } from "./actions";
import { ActionFeedbackForm } from "@/components/ui/action-feedback-form";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function BookingMatchingActions(props: {
  bookingId: string;
  neighborhood: string | null;
  professionalPaymentCents: number | null;
  address: string | null;
  expired: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [neighborhood, setNeighborhood] = useState(props.neighborhood ?? "");
  const [payment, setPayment] = useState(props.professionalPaymentCents == null ? "" : (props.professionalPaymentCents / 100).toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ready = Boolean(props.neighborhood?.trim() && props.professionalPaymentCents && props.professionalPaymentCents > 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const match = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(payment.trim());
    if (!match) { setError("Informe o repasse em reais, com até duas casas decimais."); return; }
    const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
    setSaving(true);
    try {
      const result = await prepareBookingMatchingAction({ bookingId: props.bookingId, neighborhood, professionalPaymentCents: cents });
      if (!result.ok) { setError(result.error); return; }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Não foi possível salvar. Tente novamente.");
    } finally { setSaving(false); }
  }

  return <>
    <button type="button" aria-haspopup="dialog" aria-expanded={open}
      className="text-left text-xs font-medium text-blue-700 hover:text-blue-900"
      onClick={() => {
        setNeighborhood(props.neighborhood ?? "");
        setPayment(props.professionalPaymentCents == null ? "" : (props.professionalPaymentCents / 100).toFixed(2));
        setError(null); setOpen(true);
      }}>
      {ready ? "Editar bairro e repasse" : "Informar bairro e repasse"}
    </button>
    {ready && <ActionFeedbackForm action={async () => dispatchOpportunityAction(props.bookingId)}>
      <button type="submit" className="text-xs font-medium text-blue-700 hover:text-blue-900">
        {props.expired ? "Reenviar para matching" : "Enviar para matching"}
      </button>
    </ActionFeedbackForm>}
    {open && <ModalDialog ariaLabel="Preparar oportunidade" onClose={() => { if (!saving) setOpen(false); }}>
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-96 space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <h3 className="text-sm font-semibold">Preparar oportunidade</h3>
        {props.address && <p className="text-sm text-slate-600">Endereço: {props.address}</p>}
        <label className="block space-y-1 text-sm">Bairro
          <Input value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} required minLength={2} maxLength={120} data-autofocus disabled={saving} />
        </label>
        <label className="block space-y-1 text-sm">Repasse à profissional (R$)
          <Input value={payment} onChange={(event) => setPayment(event.target.value)} required inputMode="decimal" placeholder="Ex.: 100,00" disabled={saving} />
        </label>
        <p className="text-xs text-slate-500">Após salvar, envie a oportunidade pelo botão de matching.</p>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="submit" size="sm" disabled={saving}>{saving ? "Salvando…" : "Salvar dados"}</Button>
        </div>
      </form>
    </ModalDialog>}
  </>;
}
