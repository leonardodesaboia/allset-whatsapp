import { expect, test } from "@playwright/test";

test("menu administrativo móvel abre, mantém foco e fecha por Escape sem overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("admin@allset.test");
  await page.getByLabel("Senha").fill("senha-super-segura-1");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const menuButton = page.getByRole("button", { name: "Abrir menu" });
  await expect(menuButton).toBeVisible();
  await menuButton.click();

  const dialog = page.getByRole("dialog", { name: "Menu de navegação" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Fechar menu" })).toBeFocused();
  await expect(dialog.getByRole("link", { name: "Profissionais" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Documentos" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Mensagens" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "WhatsApp" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(menuButton).toBeFocused();

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
