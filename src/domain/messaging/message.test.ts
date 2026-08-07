import { describe, expect, it } from "vitest";
import { audioPayload, textPayload } from "./message";
describe("message payloads", () => { it("normaliza texto e rejeita vazio", () => { expect(textPayload(" oi ")).toEqual({ version: 1, type: "TEXT", text: "oi" }); expect(() => textPayload(" ")).toThrow("não pode ser vazia"); }); it("aceita apenas referência válida de áudio", () => { expect(audioPayload({ id: "audio-1", storageKey: "a.ogg", contentType: "audio/ogg" }).type).toBe("AUDIO"); expect(() => audioPayload({ id: "", storageKey: "a", contentType: "audio/ogg" })).toThrow(); }); });
