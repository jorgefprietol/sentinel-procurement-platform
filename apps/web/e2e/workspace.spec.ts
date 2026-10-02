import { test, expect } from "@playwright/test";
import "../../../scripts/env.mjs";
test("Requester creates a purchase and approver records a decision in both backends", async ({
  page,
}, testInfo) => {
  for (const implementation of [".NET", "Java"]) {
    await page.goto("/");
    await page
      .getByRole("button", { name: implementation, exact: true })
      .click();
    await page.getByLabel("Usuario", { exact: true }).fill("bob");
    await page
      .getByLabel("Contraseña", { exact: true })
      .fill(process.env.BOOTSTRAP_PASSWORD!);
    await page.getByRole("button", { name: "Entrar al workspace" }).click();
    await page.getByRole("button", { name: "+ Nueva solicitud" }).click();
    const title = `Browser verified ${implementation} ${Date.now()}`;
    await page.getByLabel("Título", { exact: true }).fill(title);
    await page.getByLabel("Importe en USD").fill("350.50");
    await page
      .getByRole("button", { name: "Crear solicitud", exact: false })
      .click();
    const row = page.getByRole("row").filter({ hasText: title });
    await expect(row).toContainText("Pendiente");
    await row.getByRole("button", { name: "Evaluar proveedor" }).click();
    await expect(page.getByRole("dialog")).toContainText("LOW");
    await page.getByRole("button", { name: "Cerrar evaluación" }).click();
    await page.getByRole("button", { name: /bob · Salir/ }).click();
    await page.getByLabel("Usuario", { exact: true }).fill("approver");
    await page
      .getByLabel("Contraseña", { exact: true })
      .fill(process.env.BOOTSTRAP_PASSWORD!);
    await page.getByRole("button", { name: "Entrar al workspace" }).click();
    await row.getByRole("button", { name: "Aprobar", exact: true }).click();
    await expect(row).toContainText("Aprobada");
    const screenshot = testInfo.outputPath(
      `${implementation === ".NET" ? "dotnet" : "java"}-workspace.png`,
    );
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach(`${implementation} workspace`, {
      path: screenshot,
      contentType: "image/png",
    });
    await page.getByRole("button", { name: "Auditoría", exact: true }).click();
    await expect(page.getByRole("table")).toContainText("PURCHASE_APPROVED");
    await page.getByRole("button", { name: /approver · Salir/ }).click();
    await page.getByLabel("Usuario", { exact: true }).fill("bob");
    await page
      .getByLabel("Contraseña", { exact: true })
      .fill(process.env.BOOTSTRAP_PASSWORD!);
    await page.getByRole("button", { name: "Entrar al workspace" }).click();
    await expect(
      page.getByRole("button", { name: "Auditoría", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("PURCHASE_APPROVED", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("row").filter({ hasText: title }),
    ).toContainText("Aprobada");
    await page.getByRole("button", { name: /bob · Salir/ }).click();
  }
});
test("Controls and login remain usable at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Controles de API/ }).click();
  await expect(
    page.getByRole("heading", { name: "Validación de proveedores" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
