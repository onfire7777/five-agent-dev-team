import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const matrix = readFileSync("docs/acceptance-matrix.md", "utf8");

const requiredTraceRows = [
  {
    id: "P0-HYGIENE",
    phase: "Phase 0",
    evidence: ["package.json", "eslint.config.mjs", ".prettierrc", ".prettierignore"],
    command: "npm run check"
  },
  {
    id: "P8-DASHBOARD-SMOKE",
    phase: "Phase 8",
    evidence: ["playwright.config.ts", "tests/e2e/dashboard-smoke.spec.ts"],
    command: "npm run test:e2e"
  },
  {
    id: "P10-TRACEABILITY",
    phase: "Phase 10",
    evidence: ["docs/acceptance-matrix.md", "tests/acceptance/acceptance-matrix.test.ts"],
    command: "npm run test:acceptance"
  }
];

describe("acceptance matrix traceability", () => {
  it("covers the Phase 0, Phase 8, and Phase 10 hygiene requirements", () => {
    for (const row of requiredTraceRows) {
      expect(matrix).toContain(row.id);
      expect(matrix).toContain(row.phase);
      expect(matrix).toContain(row.command);
      for (const evidence of row.evidence) {
        expect(matrix).toContain(evidence);
      }
    }
  });
});
