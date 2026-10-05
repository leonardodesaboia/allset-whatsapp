import process from "node:process";
import console from "node:console";
import { setInterval, clearInterval } from "node:timers";
const { fetch, AbortSignal } = globalThis;

if (process.env.BETTER_AUTH_URL !== "http://localhost:3000" || process.env.JOB_QUEUE_PREFIX !== "allset:local") {
  throw new Error("Reconciliação exclusiva do ambiente local.");
}
let running = false;
let cycles = 0;
async function reconcile() {
  if (running) return;
  running = true;
  const paths = ["messaging/dispatch", "marketplace/expire", "messaging/download-audio"];
  if (cycles++ % 60 === 0) paths.push("customer/reengage", "recruitment/reengage");
  try {
    for (const path of paths) {
      const response = await fetch(`http://localhost:3000/api/cron/${path}`, {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) console.error(`Cron local ${path}: HTTP ${response.status}`);
    }
  } catch {
    console.log("Cron local aguardando o app; tentará novamente em um minuto.");
  } finally { running = false; }
}
const timer = setInterval(() => void reconcile(), 60_000);
process.on("SIGTERM", () => { clearInterval(timer); process.exit(0); });
process.on("SIGINT", () => { clearInterval(timer); process.exit(0); });
console.log("Reconciliação local ativa: despacho, áudio, expiração e lembretes.");
