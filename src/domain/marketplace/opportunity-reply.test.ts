import { describe, expect, it } from "vitest";
import { parseOpportunityReply } from "./opportunity-reply";

describe("parseOpportunityReply", () => {
  it("aceita SIM e NAO sem código para uma única oportunidade pendente", () => {
    expect(parseOpportunityReply("sim")).toEqual({ response: "ACCEPTED", responseToken: null });
    expect(parseOpportunityReply("não")).toEqual({ response: "DECLINED", responseToken: null });
  });

  it("preserva o código de correlação da oferta", () => {
    expect(parseOpportunityReply("SIM A1B2C3D4E5")).toEqual({ response: "ACCEPTED", responseToken: "A1B2C3D4E5" });
  });

  it("não aceita texto adicional ou código inválido", () => {
    expect(parseOpportunityReply("sim agora")).toBeNull();
    expect(parseOpportunityReply("sim ABC")).toBeNull();
  });
});
