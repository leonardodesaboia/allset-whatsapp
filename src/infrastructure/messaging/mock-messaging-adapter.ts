import { randomUUID } from "node:crypto";
import type { MessagingGateway, SendMessageInput, SendMessageResult } from "../../domain/ports/messaging-gateway";

export class MockMessagingAdapter implements MessagingGateway {
  readonly sent: SendMessageInput[] = [];
  private nextFailure: Error | undefined;
  failNext(error = new Error("Falha simulada de mensageria")): void { this.nextFailure = error; }
  async send(input: SendMessageInput): Promise<SendMessageResult> { const failure = this.nextFailure; this.nextFailure = undefined; if (failure) throw failure; this.sent.push({ ...input, payload: { ...input.payload } }); return { externalId: randomUUID() }; }
  capabilities() { return { text: true, audio: true }; }
  async health() { return { ok: true }; }
}
