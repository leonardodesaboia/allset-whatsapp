import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("admin@allset.test");
  await page.getByLabel("Senha").fill("senha-super-segura-1");
  await page.getByRole("button", { name: "Entrar" }).click();
});

test("kanban exibe lead e permite nota rápida", async ({ page }) => {
  await page.goto("/admin/recruitment");
  const column = page.getByTestId("column-PRE_CADASTRO");
  await expect(column.getByText("Maria de Sousa")).toBeVisible();
  await column.getByText("+ Nota").click();
  await page.getByLabel("Escrever nota interna").fill("Retornar após 14h");
  await page.getByRole("button", { name: "Salvar" }).click();
});

test("cadastro manual inclui lead nos novos leads", async ({ page }) => {
  await page.goto("/admin/recruitment");
  await page.getByTestId("new-lead").click();
  await page.getByLabel("Nome").fill("Joana Teste");
  await page.getByLabel("Bairro").fill("Meireles");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByTestId("column-LEAD").getByText("Joana Teste")).toBeVisible();
});
