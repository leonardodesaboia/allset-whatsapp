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
  await expect(
    page.getByTestId("column-LEAD").getByText(leadName)
  ).toBeVisible();
  // Aguarda o refresh do servidor assentar para não abortar o arrasto no meio.
  await page.waitForLoadState("networkidle");

  const dragHandle = page.getByRole("button", { name: `Mover ${leadName}` });
  await dragHandle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");

  await expect(
    page.getByTestId("column-PRE_CADASTRO").getByText(leadName)
  ).toBeVisible();
});

test("cadastro recebido vai à análise e permite pedir documentos com aviso", async ({
  page,
  request,
}) => {
  const phone = `5585${Date.now().toString().slice(-9)}`;
  const name = `Cadastro E2E ${Date.now()}`;
  const webhook = async (text: string) => {
    const response = await request.post("/api/messaging/evolution/webhook", {
      headers: {
        "x-allset-webhook-secret":
          "e2e-only-webhook-secret-at-least-32-characters",
      },
      data: {
        event: "messages.upsert",
        instance: "test",
        data: {
          key: {
            remoteJid: `${phone}@s.whatsapp.net`,
            fromMe: false,
            id: `${phone}-${Date.now()}-${Math.random()}`,
          },
          message: { conversation: text },
          messageType: "conversation",
          pushName: name,
        },
      },
    });
    expect(response.ok()).toBeTruthy();
  };
  for (const text of ["Oi", "2", name, "Caucaia", "3", "1 e 3", "1"])
    await webhook(text);
  await page.goto("/admin/recruitment");
  const card = page
    .getByTestId("column-TRIAGEM")
    .locator("article", { hasText: name });
  await expect(card).toBeVisible();
  await card.getByRole("link").click();
  await expect(
    page.getByText("Caucaia", { exact: false }).first()
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Analisar cadastro", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Ação registrada");
  await page
    .getByRole("button", { name: "Pedir documento", exact: true })
    .click();
  await page
    .getByLabel("Documento ou ajuste necessário")
    .fill("Documento de identidade");
  await page
    .getByRole("button", { name: "Confirmar decisão", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Aprovar", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Aguardar documento: Documento de identidade", {
      exact: false,
    })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reprovar com motivo", exact: true })
    .click();
  await page.getByLabel("Motivo da decisão").fill("Dados não confirmados");
  await page
    .getByRole("button", { name: "Confirmar decisão", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Aprovar", exact: true })
  ).toHaveCount(0);
  await page.goto("/admin/recruitment");
  await expect(
    page.getByTestId("column-REPROVADA").getByText(name)
  ).toBeVisible();
});
