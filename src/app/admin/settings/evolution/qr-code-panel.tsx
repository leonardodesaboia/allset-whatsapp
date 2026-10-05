"use client";

import { useState } from "react";
import { QrCode } from "lucide-react";
import { generateEvolutionQrCodeAction } from "./actions";

export function QrCodePanel() {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function generate() {
    setPending(true);
    setError(null);
    try {
      const result = await generateEvolutionQrCodeAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCode(result.code);
    } catch {
      setError("Não foi possível gerar o QR Code. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border-t border-slate-100 pt-4">
      <p className="text-sm text-slate-600 mb-3">Para conectar, escaneie o QR Code com o WhatsApp do número que será usado pelo bot.</p>
      <button type="button" onClick={() => void generate()} disabled={pending} className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-blue-700 hover:bg-blue-50 hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60">
        <QrCode className="w-4 h-4" />
        {pending ? "Gerando…" : "Gerar QR Code"}
      </button>
      {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
      {code && <div className="mt-3 space-y-2"><div className="inline-block rounded-lg border border-slate-200 bg-white p-3"><img src={code.startsWith("data:") ? code : `data:image/png;base64,${code}`} alt="QR Code para conectar ao WhatsApp" className="w-48 h-48" /></div><p className="text-xs text-slate-500">O QR Code expira em cerca de 60 segundos.</p></div>}
    </div>
  );
}
