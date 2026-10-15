export type InternalSchedulerConfig = {
  REDIS_URL?: string | undefined;
  INTERNAL_SCHEDULER_ENABLED?: boolean | undefined;
  NODE_ENV: string;
};

export type InternalSchedulerStatus = { enabled: boolean; reason: string };

/** Single source of truth for whether the in-process scheduler should run. */
export function resolveInternalSchedulerStatus(config: InternalSchedulerConfig): InternalSchedulerStatus {
  if (config.REDIS_URL) return { enabled: false, reason: "REDIS_URL definido: filas externas assumem o agendamento." };
  if (config.INTERNAL_SCHEDULER_ENABLED === false) return { enabled: false, reason: "Desativado por INTERNAL_SCHEDULER_ENABLED=false." };
  if (config.NODE_ENV !== "production" && config.INTERNAL_SCHEDULER_ENABLED !== true) {
    return { enabled: false, reason: "Fora de produção sem INTERNAL_SCHEDULER_ENABLED=true." };
  }
  return { enabled: true, reason: "Envio de mensagens e rotinas de manutenção rodam dentro do aplicativo." };
}
