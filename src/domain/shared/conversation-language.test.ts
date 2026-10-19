import { describe, expect, it } from "vitest";
import { parseBinaryReply, parseConversationCommand } from "./conversation-language";

describe("contextual Portuguese replies", () => {
  it.each(["pode mandar", "quero receber sim", "pode me enviar as propostas", "aceito receber", "siiiim!", "autorizo", "pode ser"])("recognizes consent: %s", text => {
    expect(parseBinaryReply(text, "CONSENT")).toBe("YES");
  });
  it.each(["não vou conseguir", "hoje não posso", "naum consigo", "não quero", "n vou", "fica pra outra", "sem interesse", "nãooo"])("recognizes a refusal: %s", text => {
    expect(parseBinaryReply(text, "OPPORTUNITY")).toBe("NO");
  });
  it.each(["pode confirmar", "conta comigo", "eu topo", "consigo ir", "estou dentro", "sim, quero!", "não tem problema", "sem problema"])("recognizes acceptance: %s", text => {
    expect(parseBinaryReply(text, "OPPORTUNITY")).toBe("YES");
  });
  it.each([
    "talvez", "acho que sim", "não sei se consigo", "aceito se pagar mais", "posso levar alguém?",
    "quero saber o valor", "não quero recusar", "sim ou não", "sim, mas só amanhã", "obrigada",
    "preciso de ajuda sim", "quero parar sim", "sim?", "sim, vou ver", "confirmo caso seja perto",
    "naum entendi", "não consegui entender",
  ])("keeps uncertainty and commands out of decisions: %s", text => {
    for (const context of ["CONSENT", "OPPORTUNITY", "CONFIRMATION"] as const)
      expect(parseBinaryReply(text, context)).toBeUndefined();
  });
  it("keeps affirmative phrases specific to the current question", () => {
    expect(parseBinaryReply("já trabalhei", "EXPERIENCE")).toBe("YES");
    expect(parseBinaryReply("já trabalhei", "CONSENT")).toBeUndefined();
    expect(parseBinaryReply("pode mandar", "OPPORTUNITY")).toBeUndefined();
    expect(parseBinaryReply("ok", "OPPORTUNITY")).toBeUndefined();
    expect(parseBinaryReply("quero saber mais", "CONSENT")).toBeUndefined();
  });
  it.each([
    ["preciso de ajuda por favor", "HELP"], ["pode me ajudar?", "HELP"],
    ["quero falar com uma pessoa", "HELP"], ["me liga por favor", "PHONE"],
    ["não quero mais receber propostas", "STOP"], ["pode parar de mandar", "STOP"],
    ["voltar ao menu", "MENU"], ["pode repetir?", "MENU"], ["não entendi direito", "MISUNDERSTOOD"],
  ])("recognizes command %s", (text, command) => {
    expect(parseConversationCommand(text)).toBe(command);
  });
  it.each(["não quero parar", "não preciso de ajuda", "não me ligue", "meu nome é Maria", "vou trabalhar sem parar"])("does not invent commands: %s", text => {
    expect(parseConversationCommand(text)).toBeUndefined();
  });
});
