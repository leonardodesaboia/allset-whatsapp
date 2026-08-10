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
