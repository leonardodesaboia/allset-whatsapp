export type MessagingConnectionConfig = {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  instance?: string | undefined;
};

export type MessagingConnectionState = {
  ok: boolean;
  state?: "open" | "connecting" | "close" | string;
  error?: string;
};

export async function fetchMessagingConnectionState(
  config: MessagingConnectionConfig,
  options: { timeoutMs?: number } = {},
): Promise<MessagingConnectionState> {
  if (!config.baseUrl || !config.apiKey || !config.instance) {
    return { ok: false, error: "NOT_CONFIGURED" };
  }
  try {
    const base = config.baseUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/instance/connectionState/${encodeURIComponent(config.instance)}`, {
      headers: { apikey: config.apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    });
    const data = (await res.json()) as {
      state?: string;
      suspended?: boolean;
      suspension_reason?: string;
      instance?: { state?: string };
    };
    if (res.status === 423 || data.suspended) {
      return { ok: false, state: "Suspensa", error: `Suspensa: ${data.suspension_reason ?? "motivo indisponível"}` };
    }
    if (!res.ok) return { ok: false, error: `HTTP_${res.status}` };
    return { ok: true, state: data.state ?? data.instance?.state ?? "unknown" };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}
