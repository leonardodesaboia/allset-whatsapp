export interface ErrorReporter {
  report(error: unknown, context?: Record<string, unknown>): void;
}
