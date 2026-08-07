import type { MessagingGateway, MessagingGatewayRegistry } from "../../domain/ports/messaging-gateway";

export class StaticMessagingGatewayRegistry implements MessagingGatewayRegistry {
  private readonly gateways: ReadonlyMap<string, MessagingGateway>;
  constructor(entries: ReadonlyArray<readonly [string, MessagingGateway]>) { this.gateways = new Map(entries); }
  get(provider: string): MessagingGateway | undefined { return this.gateways.get(provider); }
}
