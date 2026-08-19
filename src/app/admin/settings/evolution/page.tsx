import { revalidatePath } from "next/cache";
import {
  Wifi,
  WifiOff,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { env } from "@/env";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QrCodePanel } from "./qr-code-panel";

async function fetchEvolutionState(): Promise<{
  ok: boolean;
  state?: "open" | "connecting" | "close" | string;
  error?: string;
}> {
  if (!env.EVOLUTION_BASE_URL || !env.EVOLUTION_API_KEY || !env.EVOLUTION_INSTANCE) {
    return { ok: false, error: "NOT_CONFIGURED" };
  }
  try {
    const base = env.EVOLUTION_BASE_URL.replace(/\/$/, "");
    const res = await fetch(
      `${base}/instance/connectionState/${encodeURIComponent(env.EVOLUTION_INSTANCE)}`,
      {
        headers: { apikey: env.EVOLUTION_API_KEY },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return { ok: false, error: `HTTP_${res.status}` };
    const data = await res.json() as { instance?: { state?: string } };
    return { ok: true, state: (data.instance?.state ?? "unknown") as string };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}

export default async function EvolutionSettingsPage() {
  const stateResult = await fetchEvolutionState();

  const configured = env.EVOLUTION_BASE_URL && env.EVOLUTION_API_KEY && env.EVOLUTION_INSTANCE;
  const connected = stateResult.ok && stateResult.state === "open";
  const connecting = stateResult.ok && stateResult.state === "connecting";

  return (
    <div className="p-6 max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Integração Evolution</h1>
        <p className="text-sm text-slate-500 mt-0.5">Status da instância WhatsApp</p>
      </div>

      {/* Config status */}
      {!configured ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 space-y-1">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="w-4 h-4" />
            Variáveis de ambiente não configuradas
          </div>
          <p className="text-amber-700">
            Defina <code className="font-mono bg-amber-100 px-1 rounded">EVOLUTION_BASE_URL</code>,{" "}
            <code className="font-mono bg-amber-100 px-1 rounded">EVOLUTION_API_KEY</code> e{" "}
            <code className="font-mono bg-amber-100 px-1 rounded">EVOLUTION_INSTANCE</code> no ambiente de produção.
          </p>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5" />
                Conexão
              </CardTitle>
              <form action={async () => { "use server"; revalidatePath("/admin/settings/evolution"); }}>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
                >
                  <RefreshCw className="w-3 h-3" />
                  Atualizar
                </button>
              </form>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Instance info */}
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
                connected ? "bg-emerald-100" : connecting ? "bg-amber-100" : "bg-red-100"
              }`}>
                {connected
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  : connecting
                  ? <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />
                  : <WifiOff className="w-5 h-5 text-red-500" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {env.EVOLUTION_INSTANCE}
                </p>
                <p className="text-xs text-slate-500">{env.EVOLUTION_BASE_URL}</p>
              </div>
              <Badge
                variant={connected ? "success" : connecting ? "warning" : "destructive"}
                className="ml-auto"
              >
                {connected ? "Conectado" : connecting ? "Conectando…" : stateResult.state ?? "Desconectado"}
              </Badge>
            </div>

            {/* Error */}
            {!stateResult.ok && (
              <p className="text-xs text-red-600 font-mono bg-red-50 rounded px-2 py-1">
                {stateResult.error}
              </p>
            )}

            {/* QR Code section */}
            {!connected && <QrCodePanel />}

            {/* Connected info */}
            {connected && (
              <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-md px-3 py-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Instância conectada e pronta para enviar e receber mensagens.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Webhook reminder */}
      {configured && (
        <Card>
          <CardHeader>
            <CardTitle>Webhook</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-slate-600">
              Configure o webhook da Evolution para receber mensagens:
            </p>
            <div className="font-mono text-xs bg-slate-900 text-slate-100 rounded-md px-3 py-2 break-all">
              POST /api/messaging/evolution/webhook
            </div>
            <p className="text-xs text-slate-500">
              Protegido por <code className="bg-slate-100 px-1 rounded">EVOLUTION_WEBHOOK_SECRET</code>.
              Eventos necessários: <code className="bg-slate-100 px-1 rounded">MESSAGES_UPSERT</code>.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
