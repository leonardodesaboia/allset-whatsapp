import { describe, expect, it } from "vitest";
import { normalizeWhatsMiauWebhook } from "./whatsmiau-webhook";

const text = {
  event: "messages.upsert", instance: "Atendimento01",
  data: { key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "3EB04A2D1F75" }, pushName: "Maria Silva", status: "received", message: { conversation: "Ola!" }, messageType: "conversation", messageTimestamp: 1743349920, instanceId: "Atendimento01" },
};
const audio = { ...text, data: { ...text.data, message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 12, ptt: true, fileLength: "18432" }, mediaUrl: "https://storage.whatsmiau.io/media/3EB04C4D3F97.ogg", base64: "never persist" } } };

describe("WhatsMiau webhook", () => {
  it.each([
    { key: { ...text.data.key, remoteJid: "123456789012345@lid", remoteJidAlt: "5511999999999@s.whatsapp.net" } },
    { key: { ...text.data.key, remoteJid: "123456789012345@lid" }, senderPn: "5511999999999@s.whatsapp.net" },
    { key: { ...text.data.key, remoteJid: "123456789012345@lid", senderPn: "5511999999999" } },
  ])("resolves LID only from explicit phone-number fields: %j", (fields) => {
    expect(normalizeWhatsMiauWebhook({ ...text, data: { ...text.data, ...fields } })?.sender).toBe("+5511999999999");
  });
  it("does not accept a group even if an alternate phone is supplied", () => {
    expect(normalizeWhatsMiauWebhook({ ...text, data: { ...text.data, key: { ...text.data.key, remoteJid: "123@g.us", remoteJidAlt: "5511999999999@s.whatsapp.net" } } })).toBeNull();
  });
  it("normalizes the documented text and extended text", () => {
    expect(normalizeWhatsMiauWebhook(text)).toMatchObject({ sender: "+5511999999999", payload: { type: "TEXT", text: "Ola!" } });
    expect(normalizeWhatsMiauWebhook({ ...text, data: { ...text.data, message: { extendedTextMessage: { text: "Oi" } } } })?.payload).toMatchObject({ text: "Oi" });
  });
  it("accepts audio without mediaKey, retaining only retrieval metadata", () => {
    expect(normalizeWhatsMiauWebhook(audio)).toMatchObject({ payload: { type: "AUDIO", contentType: "audio/ogg; codecs=opus" }, providerMetadata: { mediaUrl: audio.data.message.mediaUrl, mimetype: "audio/ogg; codecs=opus", fileLength: "18432" } });
    expect(Object.keys(normalizeWhatsMiauWebhook(audio)!.providerMetadata!)).toEqual(["mediaUrl", "mimetype", "fileLength"]);
    expect(normalizeWhatsMiauWebhook({ ...audio, data: { ...audio.data, message: { audioMessage: audio.data.message.audioMessage }, mediaUrl: audio.data.message.mediaUrl } })).not.toBeNull();
    expect(normalizeWhatsMiauWebhook({ ...audio, data: { ...audio.data, message: { audioMessage: audio.data.message.audioMessage } } })).toBeNull();
  });
  it.each(["messages.update", "connection.update", undefined])("ignores event %s", (event) => {
    expect(normalizeWhatsMiauWebhook({ ...text, event })).toBeNull();
  });
  it.each(["1203630@g.us", "5511999999999@lid"])("ignores JID %s", (remoteJid) => {
    expect(normalizeWhatsMiauWebhook({ ...text, data: { ...text.data, key: { ...text.data.key, remoteJid } } })).toBeNull();
  });
  it("ignores echoes and malformed payloads", () => {
    expect(normalizeWhatsMiauWebhook({ ...text, data: { ...text.data, key: { ...text.data.key, fromMe: true } } })).toBeNull();
    for (const body of [null, {}, { event: "messages.upsert", data: { key: { id: 1 } } }]) expect(normalizeWhatsMiauWebhook(body)).toBeNull();
  });
});
