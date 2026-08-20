import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

const suffix = randomUUID();
const customerName = `Cliente modal ${suffix.slice(0, 8)}`;
const customerPhone = `+55859${suffix.replaceAll("-", "").slice(0, 8)}`;
let bookingId: string;
let conversationId: string;
let customerId: string;
let serviceId: string;

test.beforeAll(async () => {
  const { prisma } = await import("../../src/infrastructure/db/prisma-client");
  const service = await prisma.serviceDefinition.create({
    data: { code: `e2e-modal-${suffix}`, name: "Serviço E2E modal" },
  });
  const customer = await prisma.user.create({
    data: {
      role: "CUSTOMER",
      fullName: customerName,
      phoneE164: customerPhone,
    },
  });
  const booking = await prisma.booking.create({
    data: { customerId: customer.id, serviceId: service.id, status: "DRAFT" },
  });
  const conversation = await prisma.customerBookingConversation.create({
    data: { customerId: customer.id, bookingId: booking.id, provider: "e2e" },
  });

  serviceId = service.id;
  customerId = customer.id;
  bookingId = booking.id;
  conversationId = conversation.id;
});

test.afterAll(async () => {
  const { prisma } = await import("../../src/infrastructure/db/prisma-client");
  await prisma.customerBookingConversation.delete({
    where: { id: conversationId },
  });
  await prisma.booking.delete({ where: { id: bookingId } });
  await prisma.user.delete({ where: { id: customerId } });
  await prisma.serviceDefinition.delete({ where: { id: serviceId } });
});

test("mensagem ao cliente restaura foco e não causa overflow em 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("admin@allset.test");
  await page.getByLabel("Senha").fill("senha-super-segura-1");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/bookings");
  const bookingCard = page.locator("div.rounded-lg", { hasText: customerName });
  const trigger = bookingCard.getByRole("button", { name: "Enviar msg" });
  await trigger.click();

  const dialog = page.getByRole("dialog", {
    name: "Enviar mensagem ao cliente",
  });
  await expect(dialog.getByPlaceholder("Digite a mensagem…")).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    )
    .toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
