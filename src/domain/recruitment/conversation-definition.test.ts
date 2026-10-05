import { describe, expect, it } from "vitest";
import { QUESTIONS, globalCommand, normalizeAnswer, parseAnswer } from "./conversation-definition";

describe("conversation definition", () => {
  it("mantém perguntas e comandos normalizados", () => {
    expect(QUESTIONS.SERVICE_AREA?.options).toContain("NAO");
    expect(normalizeAnswer(" Não! ")).toBe("NAO");
    expect(globalCommand("ligação")).toBe("PHONE");
  });

  it("converte opções numéricas no estado correto", () => {
    expect(parseAnswer("CHANNEL_PREFERENCE", "2")).toBe("PHONE");
    expect(parseAnswer("PROFESSIONAL_EXPERIENCE", "1")).toBe("SIM");
    expect(parseAnswer("SERVICE_AREA", "3")).toBe("NAO");
  });

  it("tolera formas comuns de escrita sem decidir respostas incertas", () => {
    expect(parseAnswer("PROFESSIONAL_EXPERIENCE", "simm, já trabalhei")).toBe("SIM");
    expect(parseAnswer("INFORMAL_EXPERIENCE", "naum fiz")).toBe("NAO");
    expect(parseAnswer("PROFESSIONAL_EXPERIENCE", "nao sei")).toBeUndefined();
    expect(parseAnswer("SERVICE_AREA", "talveis consigo")).toBe("TALVEZ");
    expect(parseAnswer("SERVICE_AREA", "não sei")).toBe("TALVEZ");
  });
});
