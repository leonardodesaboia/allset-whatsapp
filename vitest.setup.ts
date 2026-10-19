import dotenv from "dotenv";
import path from "path";

// Load .env file for tests
dotenv.config({
  path: path.resolve(import.meta.dirname, ".env"),
});

// Mantém a suíte unitária autocontida quando o desenvolvedor ainda não criou
// `.env`. Valores reais do arquivo continuam prevalecendo.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/allset_test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-with-at-least-thirty-two-characters";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
// Sem o intervalo de 30s entre envios do WhatsApp: as suítes despacham várias
// mensagens seguidas. O teste específico do intervalo o liga explicitamente.
process.env.WHATSAPP_MESSAGE_INTERVAL_SECONDS = "0";
