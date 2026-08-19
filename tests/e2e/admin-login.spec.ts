import { expect, test } from "@playwright/test";

test("admin faz login e acessa o dashboard, depois faz logout", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("admin@allset.test");
  await page.getByLabel("Senha").fill("senha-super-segura-1");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();
  await expect(page.getByText("Visão geral da operação")).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("visitante sem sessão é redirecionado de /admin para /login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
});
