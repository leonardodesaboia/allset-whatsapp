import { describe, expect, it } from "vitest";
import { CUSTOMER_QUESTIONS, parseCustomerChoice } from "./customer-conversation-definition";

describe("customer conversation choices", () => {
  it("declara escolhas estruturadas nas perguntas fechadas", () => {
    expect(CUSTOMER_QUESTIONS.INTRODUCTION?.choices).toHaveLength(2);
    expect(CUSTOMER_QUESTIONS.QUOTE_ACCEPTANCE?.choices?.[0]?.value).toBe("ACCEPT");
  });

  it("aceita o índice da opção sem exigir texto livre", () => {
    expect(parseCustomerChoice("INTRODUCTION", "1")).toBe("YES");
    expect(parseCustomerChoice("FINAL_CONFIRMATION", "2")).toBe("CHANGE");
  });
});
