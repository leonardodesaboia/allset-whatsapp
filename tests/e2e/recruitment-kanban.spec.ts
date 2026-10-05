import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("admin@allset.test");
  await page.getByLabel("Senha").fill("senha-super-segura-1");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
});

test("kanban exibe lead e permite nota rápida", async ({ page }) => {
  await page.goto("/admin/recruitment");
  const column = page.getByTestId("column-PRE_CADASTRO");
  const mariaCard = column.locator("article", { hasText: "Maria de Sousa" });
  await expect(mariaCard).toBeVisible();
  const noteButton = mariaCard.getByRole("button", { name: "Nota" });
  await noteButton.click();
  await expect(page.getByLabel("Escrever nota interna")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(noteButton).toBeFocused();

  await noteButton.click();
  await page.getByLabel("Escrever nota interna").fill("Retornar após 14h");
  await page.getByRole("button", { name: "Salvar" }).click();
});

test("cadastro manual inclui lead nos novos leads", async ({ page }) => {
  const leadName = `Joana E2E ${Date.now()}`;
  await page.goto("/admin/recruitment");
  await page.getByTestId("new-lead").click();
  await page.getByLabel("Nome").fill(leadName);
  await page.getByLabel("Bairro").fill("Meireles");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(
    page.getByTestId("column-LEAD").getByText(leadName)
  ).toBeVisible();
});

test("kanban permite mover lead pelo teclado", async ({ page }) => {
  const leadName = `Teclado E2E ${Date.now()}`;
  await page.goto("/admin/recruitment");
  await page.getByTestId("new-lead").click();
  await page.getByLabel("Nome").fill(leadName);
  await page.getByRole("button", { name: "Salvar" }).click();

  const dragHandle = page.getByRole("button", { name: `Mover ${leadName}` });
  await dragHandle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");

  await expect(
    page.getByTestId("column-PRE_CADASTRO").getByText(leadName)
  ).toBeVisible();
});
