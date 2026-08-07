import { describe, expect, it } from "vitest";
import { textPayload } from "../../domain/messaging/message";
import { MockMessagingAdapter } from "./mock-messaging-adapter";
describe("MockMessagingAdapter", () => { it("registra envio sem I/O e simula falha", async () => { const adapter = new MockMessagingAdapter(); await adapter.send({ recipient: "+5585", payload: textPayload("Olá"), idempotencyKey: "a" }); expect(adapter.sent).toHaveLength(1); adapter.failNext(); await expect(adapter.send({ recipient: "+5585", payload: textPayload("Olá"), idempotencyKey: "b" })).rejects.toThrow("Falha simulada"); }); });
