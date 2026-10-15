import type { MessagingGateway, MessagingGatewayRegistry } from "../../domain/ports/messaging-gateway";

export class StaticMessagingGatewayRegistry implements MessagingGatewayRegistry {
  private readonly gateways: ReadonlyMap<string, MessagingGateway>;
  constructor(entries: ReadonlyArray<readonly [string, MessagingGateway]>) { this.gateways = new Map(entries); }
  get(provider: string): MessagingGateway | undefined { return this.gateways.get(provider); }
  canonicalProvider(provider: string): string {
    const gateway = this.get(provider);
    if (gateway) for (const [name, candidate] of this.gateways) if (candidate === gateway) return name;
    return provider;
  }
  aliasesFor(provider: string): string[] {
    const gateway = this.get(provider);
    return gateway ? [...this.gateways].filter(([, candidate]) => candidate === gateway).map(([name]) => name) : [provider];
  }
}
