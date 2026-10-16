import { describe, expect, it } from "vitest";
import {
  QUESTIONS,
  globalCommand,
  normalizeAnswer,
  parseAnswer,
} from "./conversation-definition";

describe("conversation definition", () => {
  it("reconhece pedidos explícitos de atendimento e pausa sem capturar frases comuns", () => {
    expect(globalCommand("Falar com um atendente!")).toBe("HELP");
    expect(globalCommand("atendente")).toBe("HELP");
    expect(globalCommand("cancelar")).toBe("STOP");
    expect(
      globalCommand("preciso de ajuda para limpar a cozinha")
    ).toBeUndefined();
  });
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
    expect(parseAnswer("PROFESSIONAL_EXPERIENCE", "simm, já trabalhei")).toBe(
      "SIM"
    );
    expect(parseAnswer("INFORMAL_EXPERIENCE", "naum fiz")).toBe("NAO");
    expect(parseAnswer("PROFESSIONAL_EXPERIENCE", "nao sei")).toBeUndefined();
    expect(parseAnswer("SERVICE_AREA", "talveis consigo")).toBe("TALVEZ");
    expect(parseAnswer("SERVICE_AREA", "não sei")).toBe("TALVEZ");
  });
  it("aceita experiência por números ou áudio transcrito, sem adivinhar sim genérico", () => {
    expect(parseAnswer("EXPERIENCE_KIND", "1")).toBe("FORMAL");
    expect(parseAnswer("EXPERIENCE_KIND", "Trabalhei numa empresa")).toBe(
      "FORMAL"
    );
    expect(
      parseAnswer("EXPERIENCE_KIND", "Eu fazia faxinas como diarista")
    ).toBe("DIARISTA");
    expect(parseAnswer("EXPERIENCE_KIND", "Ainda não trabalhei")).toBe("NONE");
    expect(parseAnswer("EXPERIENCE_KIND", "sim")).toBeUndefined();
  });
  it("traduz múltipla escolha em dias legíveis e rejeita opções fora da lista", () => {
    expect(parseAnswer("AVAILABILITY", "1 e 3")).toBe(
      "Segunda a sexta de manhã; Sábado"
    );
    expect(parseAnswer("AVAILABILITY", "2, 4")).toBe(
      "Segunda a sexta à tarde; Domingo"
    );
    expect(parseAnswer("AVAILABILITY", "1 e 9")).toBeUndefined();
    expect(parseAnswer("AVAILABILITY", "terça de manhã")).toBe(
      "terça de manhã"
    );
  });
  it.each([
    "oi",
    "Bom dia!",
    "menu",
    "ajuda",
    "boa noite",
    "falar com atendente",
    "1",
    "",
  ])("não salva saudação/comando como campo: %s", (text) => {
    expect(parseAnswer("NAME", text)).toBeUndefined();
    expect(parseAnswer("REGIONS", text)).toBeUndefined();
  });
  it("seleciona correção específica e confirmação por texto", () => {
    expect(parseAnswer("CONFIRMATION", "confirmo")).toBe("CONFIRM");
    expect(parseAnswer("CONFIRMATION", "corrigir")).toBe("EDIT");
    expect(parseAnswer("EDIT_SELECTION", "regiões")).toBe("REGIONS");
  });
});
