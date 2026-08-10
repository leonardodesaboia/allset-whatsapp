import { env } from "../../env";
import { createRuntimeStorage } from "../storage/storage-runtime";
import { EvolutionMessagingAdapter } from "./evolution-messaging-adapter";
import { StaticMessagingGatewayRegistry } from "./messaging-gateway-registry";

export function createMessagingGatewayRegistry() {
  const evolution = [env.EVOLUTION_BASE_URL, env.EVOLUTION_API_KEY, env.EVOLUTION_INSTANCE];
  if (evolution.every(Boolean)) {
    const storage = createRuntimeStorage();
    return new StaticMessagingGatewayRegistry([
      ["evolution", new EvolutionMessagingAdapter({
        baseUrl: env.EVOLUTION_BASE_URL!,
        apiKey: env.EVOLUTION_API_KEY!,
        instance: env.EVOLUTION_INSTANCE!,
      }, storage)],
    ]);
  }
  if (evolution.some(Boolean)) {
    throw new Error("Configuração da Evolution incompleta");
  }
  return new StaticMessagingGatewayRegistry([]);
}
