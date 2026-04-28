import { expect, test } from "@playwright/test";

test.describe("dashboard smoke", () => {
  test("loads the operator dashboard without viewport overflow", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
        consoleErrors.push(message.text());
      }
    });

    await page.route("http://127.0.0.1:4310/api/**", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "*"
        },
        body: JSON.stringify({ error: "controller intentionally offline for dashboard smoke" })
      });
    });

    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Autonomous Control" })).toBeVisible();
    await expect(page.getByTestId("work-intake")).toBeVisible();
    await expect(page.getByTestId("active-loop")).toBeVisible();
    await expect(page.getByTestId("release-panel")).toBeVisible();

    await page.getByText("Work options").click();
    await expect(page.getByLabel("Type")).toBeVisible();
    await expect(page.getByLabel("Priority")).toBeVisible();
    await expect(page.getByLabel("Risk")).toBeVisible();
    await expect(page.getByLabel("Acceptance criteria")).toBeVisible();
    await expect(page.getByLabel("Agent routing")).toBeVisible();

    const insightValues = await page
      .getByTestId("insight-select")
      .locator("option")
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    expect(insightValues).toEqual(["release", "team", "memory", "events"]);

    await page.getByTestId("insight-select").selectOption("team");
    await expect(page.getByTestId("team-panel")).toBeVisible();

    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth
    }));

    expect(Math.max(viewport.scrollWidth, viewport.bodyScrollWidth)).toBeLessThanOrEqual(viewport.clientWidth + 2);
    expect(consoleErrors).toEqual([]);
  });
});
