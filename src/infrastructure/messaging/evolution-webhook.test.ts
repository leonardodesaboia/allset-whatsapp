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

    expect(normalizeEvolutionWebhook(event, "+5585987231727")).toEqual({
      externalId: "msg-1",
      sender: "+5585999999999",
      recipient: "+5585987231727",
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

  it("ignores malformed bodies and non-phone JIDs without throwing", () => {
    for (const body of [null, [], "text", { data: null }, { data: { key: { id: 7, remoteJid: 123 } } }]) {
      expect(normalizeEvolutionWebhook(body)).toBeNull();
    }
    for (const remoteJid of ["1234567890123@lid", "status@broadcast", "1234567890123@newsletter"]) {
      expect(normalizeEvolutionWebhook({ data: { key: { id: "msg", remoteJid }, message: { conversation: "Oi" } } })).toBeNull();
    }
  });

  it("resolves a LID only when Evolution provides the real phone as remoteJidAlt", () => {
    expect(normalizeEvolutionWebhook({ data: {
      key: { id: "lid-msg", remoteJid: "1234567890123@lid", remoteJidAlt: "5585999999999@s.whatsapp.net" },
      message: { conversation: "Oi" },
    } }, "+5585987231727")).toMatchObject({ sender: "+5585999999999", recipient: "+5585987231727" });
  });
});
