type AuthRateLimitConfig = Readonly<{
  baseUrl: string;
  disableForE2E?: boolean;
}>;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * O bypass existe exclusivamente para o servidor local iniciado pelo harness.
 * A checagem de loopback duplica deliberadamente a validação de `env.ts`:
 * caso esta função seja reutilizada com outra fonte de configuração, uma
 * flag copiada para uma origem pública continua sem desabilitar a proteção.
 */
export function isAuthRateLimitEnabled(config: AuthRateLimitConfig): boolean {
  if (!config.disableForE2E) return true;

  try {
    return !LOOPBACK_HOSTS.has(new URL(config.baseUrl).hostname);
  } catch {
    return true;
  }
}
