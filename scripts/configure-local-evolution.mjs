import process from "node:process";
import console from "node:console";
const { fetch, AbortSignal } = globalThis;

const base = process.env.EVOLUTION_BASE_URL;
const instance = process.env.EVOLUTION_INSTANCE;
if (base !== "http://127.0.0.1:18080" || instance !== "allset-local") {
  throw new Error("Este comando configura apenas a Evolution local.");
}
const headers = { apikey: process.env.EVOLUTION_API_KEY, "content-type": "application/json" };
async function request(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Evolution local: ${method} ${path} retornou HTTP ${response.status}`);
  return response.json();
}
const existing = await fetch(`${base}/instance/connectionState/${instance}`, { headers, signal: AbortSignal.timeout(10_000) });
if (existing.status === 404 || existing.status === 400) {
  await request("/instance/create", "POST", {
    instanceName: instance, integration: "WHATSAPP-BAILEYS", qrcode: false,
    groupsIgnore: true, alwaysOnline: false, readMessages: false, readStatus: false, syncFullHistory: false,
  });
} else if (!existing.ok) {
  throw new Error(`Evolution local indisponível: HTTP ${existing.status}`);
}
await request(`/webhook/set/${instance}`, "POST", { webhook: {
  enabled: true,
  url: "http://host.docker.internal:3000/api/messaging/evolution/webhook",
  byEvents: false, base64: false,
  events: ["MESSAGES_UPSERT"],
  headers: { "x-allset-webhook-secret": process.env.EVOLUTION_WEBHOOK_SECRET },
} });
const webhook = await request(`/webhook/find/${instance}`);
if (!webhook.enabled || webhook.url !== "http://host.docker.internal:3000/api/messaging/evolution/webhook"
  || webhook.headers?.["x-allset-webhook-secret"] !== process.env.EVOLUTION_WEBHOOK_SECRET) {
  throw new Error("A Evolution não confirmou a configuração do webhook.");
}
const state = await request(`/instance/connectionState/${instance}`);
console.log(`Evolution local configurada. Instância: ${instance}; estado: ${state.instance?.state ?? "desconhecido"}.`);
console.log("Abra http://localhost:3000/admin/settings/evolution e gere o QR Code para conectar.");
