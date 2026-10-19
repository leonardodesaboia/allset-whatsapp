import { describe, expect, it } from "vitest";
import { CUSTOMER_QUESTIONS, parseCustomerChoice } from "./customer-conversation-definition";

describe("customer conversation choices", () => {
  it("declara escolhas estruturadas nas perguntas fechadas", () => {
    expect(CUSTOMER_QUESTIONS.INTRODUCTION?.choices).toHaveLength(2);
    expect(CUSTOMER_QUESTIONS.FINAL_CONFIRMATION?.choices?.[0]?.value).toBe("CONFIRM");
    expect(CUSTOMER_QUESTIONS.EDIT_SELECTION?.choices?.map((choice) => choice.value)).toEqual(["SCHEDULE", "ADDRESS", "DETAILS"]);
  });

  it("não pergunta mais o tipo de imóvel em opções: a descrição é livre", () => {
    expect(CUSTOMER_QUESTIONS.PROPERTY_CHARACTERISTICS?.choices).toBeUndefined();
    expect(CUSTOMER_QUESTIONS.SCHEDULE_TIME?.choices).toBeUndefined();
  });

  it("aceita o índice da opção sem exigir texto livre", () => {
    expect(parseCustomerChoice("INTRODUCTION", "1")).toBe("YES");
    expect(parseCustomerChoice("FINAL_CONFIRMATION", "2")).toBe("CHANGE");
    expect(parseCustomerChoice("EDIT_SELECTION", "3")).toBe("DETAILS");
  });

  it("aceita o rótulo e respostas naturais das escolhas", () => {
    expect(parseCustomerChoice("INTRODUCTION", "Quero contratar")).toBe("YES");
    expect(parseCustomerChoice("FINAL_CONFIRMATION", "confirmar")).toBe("CONFIRM");
    expect(parseCustomerChoice("FINAL_CONFIRMATION", "alterar")).toBe("CHANGE");
  });
});
