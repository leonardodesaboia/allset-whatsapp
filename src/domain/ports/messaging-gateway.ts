import type { OutboundMessagePayload } from "../messaging/message";

export interface SendMessageInput { recipient: string; payload: OutboundMessagePayload; idempotencyKey: string; correlationId?: string; }
export interface SendMessageResult { externalId: string; }
export interface MessagingGateway { send(input: SendMessageInput): Promise<SendMessageResult>; capabilities(): { text: boolean; audio: boolean }; health(): Promise<{ ok: boolean }>; }
export interface MessagingGatewayRegistry { get(provider: string): MessagingGateway | undefined; }
