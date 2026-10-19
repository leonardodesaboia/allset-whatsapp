import { describe, expect, it } from "vitest";
import {
  formatCustomerContactMessage,
  formatProfessionalContactMessage,
  whatsappLink,
} from "./contact-exchange-message";

// 14:00 em Fortaleza = 17:00 UTC
const scheduledAt = new Date("2026-10-18T17:00:00.000Z");

describe("troca de contatos", () => {
  it("gera link do WhatsApp só com dígitos", () => {
    expect(whatsappLink("+5585988887777")).toBe("https://wa.me/5585988887777");
  });

  it("cliente recebe nome e WhatsApp da profissional", () => {
    const text = formatCustomerContactMessage({
      professionalName: "Maria Silva",
      professionalPhoneE164: "+5585911112222",
      scheduledAt,
    });
    expect(text).toContain("Maria Silva");
    expect(text).toContain("+5585911112222");
    expect(text).toContain("https://wa.me/5585911112222");
    expect(text).toContain("14:00");
    expect(text).not.toMatch(/pagamento|PIX|equipe confirmará/i);
  });

  it("profissional recebe nome, WhatsApp, endereço, dia/hora e faixa do imóvel", () => {
    const text = formatProfessionalContactMessage({
      customerName: "Ana Souza",
      customerPhoneE164: "+5585900001111",
      scheduledAt,
      address: "Rua A, 10, Aldeota",
      propertyLabel: "Apartamento até 60 m²",
      estimatedValueCents: 15000,
    });
    expect(text).toContain("Ana Souza");
    expect(text).toContain("+5585900001111");
    expect(text).toContain("Rua A, 10, Aldeota");
    expect(text).toContain("14:00");
    expect(text).toContain("Apartamento até 60 m²");
    expect(text).toContain("R$ 150,00");
    expect(text).toContain("combine o valor final direto");
  });

  it("profissional recebe a descrição do serviço informada pelo cliente", () => {
    const text = formatProfessionalContactMessage({
      customerName: "Ana Souza",
      customerPhoneE164: "+5585900001111",
      scheduledAt,
      address: "Rua A, 10, Aldeota",
      propertyLabel: null,
      estimatedValueCents: null,
      serviceDetails: "Casa 3 quartos, tenho os produtos",
    });
    expect(text).toContain("📝 Detalhes: Casa 3 quartos, tenho os produtos");
    expect(text).not.toContain("Valor estimado");
  });
});
