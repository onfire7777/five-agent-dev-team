import { expect, test, type Request } from "@playwright/test";

function createStatus(emergencyStop = false) {
  return {
    system: {
      name: "AI Dev Team Controller",
      operational: true,
      emergencyStop,
      queueDepth: 1,
      agentsOnline: 5,
      agentsTotal: 5,
      githubSync: "synced",
      systemLoad: 0.2,
      emergencyReason: emergencyStop ? "[global] Operator dashboard control" : "",
      scheduler: {
        maxConcurrentAgentRuns: 5
      }
    },
    pipeline: {
      INTAKE: 0,
      RND: 0,
      PROPOSAL: 0,
      ARCHITECTURE_REVIEW: 0,
      BACKEND_BUILD: 0,
      FRONTEND_BUILD: 0,
      INTEGRATION: 0,
      VERIFY: 1,
      RELEASE: 0,
      CLOSED: 0,
      BLOCKED: 0
    },
    projectTeams: [],
    workItems: [],
    artifacts: [],
    releaseReadiness: {
      status: "ready",
      target: "Local verification",
      checks: []
    },
    logs: [],
    sharedContext: {
      activeThreads: [],
      research: []
    }
  };
}

function readEmergencyPayload(request: Request) {
  let payload: unknown;
  try {
    payload = request.postDataJSON();
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") return null;
  const { scope, reason } = payload as Record<string, unknown>;
  if (typeof scope !== "string" || !scope.trim()) return null;
  if (typeof reason !== "string" || !reason.trim()) return null;
  return { scope, reason };
}

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
    await expect(page.getByTestId("top-bar")).toBeVisible();
    await expect(page.getByTestId("project-bar")).toBeVisible();
    await expect(page.getByTestId("work-intake")).toBeVisible();
    await expect(page.getByTestId("active-loop")).toBeVisible();
    await expect(page.getByTestId("insight-panel")).toBeVisible();
    await expect(page.getByTestId("release-panel")).toBeVisible();

    const surfacesRenderInOrder = await page.evaluate(() => {
      const ids = ["top-bar", "project-bar", "work-intake", "active-loop", "insight-panel"];
      const elements = ids.map((id) => document.querySelector(`[data-testid="${id}"]`));
      return elements.every((element, index) => {
        if (!element) return false;
        if (index === 0) return true;
        const previous = elements[index - 1];
        return Boolean(previous && previous.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
    });
    expect(surfacesRenderInOrder).toBe(true);

    await expect(page.getByTestId("project-picker")).toBeVisible();
    await expect(page.getByTestId("project-status-chips")).toContainText("Sync offline");
    await page.getByTestId("project-connect").getByText("+ Connect").click();
    await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Owner/name", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Local path", { exact: true })).toBeVisible();

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

  test("posts emergency stop and resume controls", async ({ page }) => {
    let emergencyStop = false;
    const postedPaths: string[] = [];

    await page.route("http://127.0.0.1:4310/api/**", async (route) => {
      const url = new URL(route.request().url());
      const request = route.request();
      const jsonHeaders = {
        "access-control-allow-origin": "*",
        "content-type": "application/json"
      };

      if (url.pathname === "/api/status") {
        await route.fulfill({
          status: 200,
          headers: jsonHeaders,
          body: JSON.stringify(createStatus(emergencyStop))
        });
        return;
      }
      if (url.pathname === "/api/memories" || url.pathname === "/api/projects") {
        await route.fulfill({ status: 200, headers: jsonHeaders, body: "[]" });
        return;
      }
      if (url.pathname === "/api/github/account") {
        await route.fulfill({
          status: 200,
          headers: jsonHeaders,
          body: JSON.stringify({
            connected: false,
            source: "none",
            scopes: [],
            utilities: [],
            clientIdConfigured: false,
            message: "Not connected"
          })
        });
        return;
      }
      if (request.method() === "POST" && url.pathname === "/api/emergency-stop") {
        const payload = readEmergencyPayload(request);
        if (!payload) {
          await route.fulfill({
            status: 400,
            headers: jsonHeaders,
            body: JSON.stringify({ error: "missing emergency scope or reason" })
          });
          return;
        }
        postedPaths.push(url.pathname);
        emergencyStop = true;
        await route.fulfill({
          status: 200,
          headers: jsonHeaders,
          body: JSON.stringify({ emergencyStop: true, ...payload })
        });
        return;
      }
      if (request.method() === "POST" && url.pathname === "/api/emergency-resume") {
        const payload = readEmergencyPayload(request);
        if (!payload) {
          await route.fulfill({
            status: 400,
            headers: jsonHeaders,
            body: JSON.stringify({ error: "missing emergency scope or reason" })
          });
          return;
        }
        postedPaths.push(url.pathname);
        emergencyStop = false;
        await route.fulfill({
          status: 200,
          headers: jsonHeaders,
          body: JSON.stringify({ emergencyStop: false, ...payload })
        });
        return;
      }

      await route.fulfill({ status: 404, headers: jsonHeaders, body: JSON.stringify({ error: "not found" }) });
    });

    await page.goto("/");

    const emergencyToggle = page.getByTestId("emergency-toggle");
    await expect(emergencyToggle).toHaveText(/Stop/);
    await emergencyToggle.click();
    await expect(emergencyToggle).toHaveText(/Resume/);
    await expect(page.getByRole("status")).toContainText("Operator dashboard control");

    await emergencyToggle.click();
    await expect(emergencyToggle).toHaveText(/Stop/);
    expect(postedPaths).toEqual(["/api/emergency-stop", "/api/emergency-resume"]);
  });
});
