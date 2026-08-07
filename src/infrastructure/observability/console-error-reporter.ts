import type { ErrorReporter } from "../../domain/ports/error-reporter";
import { logger } from "./logger";

export class ConsoleErrorReporter implements ErrorReporter {
  report(error: unknown, context?: Record<string, unknown>): void {
    logger.error({ err: error, ...context }, "Erro reportado");
  }
}
