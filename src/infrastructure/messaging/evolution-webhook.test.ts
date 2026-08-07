import { describe, expect, it } from "vitest";
import { isValidEvolutionWebhook, normalizeEvolutionWebhook } from "./evolution-webhook";

describe("Evolution webhook normalization", () => {
  it("normalizes an inbound text message and ignores outbound echoes", () => {
    const event = {
      data: {
        key: { id: "msg-1", remoteJid: "5585999999999@s.whatsapp.net", fromMe: false },
        message: { conversation: "Oi" },
      },
    };

    expect(normalizeEvolutionWebhook(event)).toEqual({
      externalId: "msg-1",
      sender: "+5585999999999",
      recipient: "allset",
      payload: { version: 1, type: "TEXT", text: "Oi" },
    });
    expect(normalizeEvolutionWebhook({ ...event, data: { ...event.data, key: { ...event.data.key, fromMe: true } } })).toBeNull();
    expect(normalizeEvolutionWebhook({ ...event, data: { ...event.data, key: { ...event.data.key, remoteJid: "1203630@g.us" } } })).toBeNull();
  });

  it("uses a timing-safe shared secret check", () => {
    expect(isValidEvolutionWebhook("a".repeat(32), "a".repeat(32))).toBe(true);
    expect(isValidEvolutionWebhook("a".repeat(32), "b".repeat(32))).toBe(false);
    expect(isValidEvolutionWebhook(undefined, "a".repeat(32))).toBe(false);
  });
});
