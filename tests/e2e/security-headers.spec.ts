import { expect, test } from "@playwright/test";

test("respostas públicas incluem headers básicos de segurança", async ({ request }) => {
  const response = await request.get("/login");

  expect(response.ok()).toBe(true);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(response.headers()["permissions-policy"]).toContain("camera=()");
});
