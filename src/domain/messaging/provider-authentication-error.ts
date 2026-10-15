/** Misconfigured credentials must not exhaust individual message retry budgets. */
export class ProviderAuthenticationError extends Error {
  constructor(message: string, readonly httpStatus: 401 | 403) {
    super(message);
    this.name = "ProviderAuthenticationError";
  }
}
