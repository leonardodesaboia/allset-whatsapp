import { randomBytes } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import console from "node:console";

await mkdir(".local", { recursive: true });
let exists = false;
try { await access(".env.local"); exists = true; } catch { /* First setup. */ }
if (exists) {
  console.log(".env.local já existe; configuração preservada.");
  process.exit(0);
}
const secret = () => randomBytes(24).toString("hex");
const dbPassword = secret();
const config = {
  NODE_ENV: "development",
  LOCAL_DB_PASSWORD: dbPassword,
  LOCAL_EVOLUTION_DB_PASSWORD: secret(),
  DATABASE_URL: `postgresql://allset_local:${dbPassword}@127.0.0.1:55432/allset_local?schema=public`,
  BETTER_AUTH_SECRET: secret(),
  BETTER_AUTH_URL: "http://localhost:3000",
  REDIS_URL: "redis://127.0.0.1:56379/0",
  JOB_QUEUE_PREFIX: "allset:local",
  EVOLUTION_BASE_URL: "http://127.0.0.1:18080",
  EVOLUTION_API_KEY: secret(),
  EVOLUTION_INSTANCE: "allset-local",
  EVOLUTION_WEBHOOK_SECRET: secret(),
  INTERNAL_JOB_SECRET: secret(),
  CRON_SECRET: secret(),
  WHATSAPP_NUMBER: "5585987231727",
  MESSAGING_DEFAULT_PROVIDER: "evolution",
  S3_ENDPOINT: "", S3_BUCKET: "", S3_REGION: "",
  S3_ACCESS_KEY_ID: "", S3_SECRET_ACCESS_KEY: "", S3_PUBLIC_URL: "",
  LOCAL_STORAGE_DIR: ".local/storage",
  LOCAL_ADMIN_EMAIL: "admin@allset.local",
  LOCAL_ADMIN_PASSWORD: `Allset-${randomBytes(12).toString("hex")}`,
};
await writeFile(".env.local", "# Ambiente local AllSet. Gerado por local:configure; não versionar.\n"
  + Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n", { flag: "wx" });
console.log("Ambiente local criado em .env.local. Banco, segredos e instância separados da VPS.");
