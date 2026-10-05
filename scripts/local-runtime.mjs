import dotenv from "dotenv";
import { spawn } from "node:child_process";
import process from "node:process";
import console from "node:console";
import { access } from "node:fs/promises";

await access(".env.local");
dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });
const mode = process.argv[2];
const commands = {
  dev: ["node_modules/next/dist/bin/next", "dev", "--hostname", "0.0.0.0"],
  worker: ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "tsconfig.json", "src/worker/main.ts"],
  seed: ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "tsconfig.json", "scripts/seed-local.ts"],
  migrate: ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  evolution: ["scripts/configure-local-evolution.mjs"],
};
if (!commands[mode] && mode !== "start") throw new Error("Modo local inválido.");
const children = (mode === "start" ? [commands.dev, commands.worker, ["scripts/local-reconcile.mjs"]] : [commands[mode]])
  .map((args) => spawn(process.execPath, args, { stdio: "inherit", env: process.env }));
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("error", (error) => { console.error(error.message); stop(); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 0; if (mode === "start") stop(); });
}
