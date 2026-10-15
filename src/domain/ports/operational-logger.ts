/** Runtime-provided diagnostics without coupling use cases to a logging library. */
export interface OperationalLogger {
  error(context: Record<string, unknown>, message: string): void;
}
