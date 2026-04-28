import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const matrix = readFileSync("docs/acceptance-matrix.md", "utf8");

const expectedRows = [
  ["A01", "An illegal state transition is rejected by the guard.", "unit", "P3-A5"],
  ["A02", "Schema validation rejects a malformed brief.", "unit", "P1-A3"],
  ["A03", "A cross-project memory read returns empty.", "integration", "P2-A2, P7-A2"],
  ["A04", "Two projects: simultaneous work items advance independently.", "integration", "P3-A3, P7-A1"],
  ["A05", "Same project: a second work item waits until the first reaches `CLOSED`.", "integration", "P3-A4"],
  ["A06", "The loop snapshot includes `latest_completed_loop` after a prior closure.", "integration", "P3-A2, P9-A2"],
  ["A07", "Emergency stop blocks the next activity within 5 seconds.", "integration", "P9-A5"],
  ["A08", "A sync-invariant violation transitions the work item to `BLOCKED`.", "integration", "P5-A3"],
  ["A09", "Absent `GH_TOKEN`: work-item creation fails closed with a clear error.", "integration", "P5-A4"],
  ["A10", "An MCP server failing to start is non-fatal; the capability is dropped.", "integration", "P6-A1, P6-A2"],
  ["A11", "The dashboard renders without horizontal scroll at a 360 px viewport.", "e2e", "P8-A1"],
  ["A12", "The SSE stream emits heartbeats at the configured 15-second interval.", "integration", "P2-A6"],
  ["A13", "Release rollback executes when the post-release health check fails.", "e2e", "P9-A3, P9-A4"],
  ["A14", "`gitleaks` blocks a push containing a synthetic AKIA test secret.", "integration", "P10-A3"],
  ["A15", "`npm audit --audit-level=high` is clean (only documented advisories tolerated).", "ci", "P10-A2"],
  ["A16", "A `SKILL.md` with malformed frontmatter is rejected at boot with a precise error.", "unit", "P4-A8, P4-A9"],
  ["A17", "A skill is not loaded when neither stage nor keyword triggers match.", "integration", "P4-A4"],
  ["A18", "An agent's request to `skill.load` for a skill outside its `audience` is refused.", "integration", "P4-A6"],
  [
    "A19",
    "Total injected skill text > 16 KB causes lower-priority skills to be dropped with an event.",
    "integration",
    "P4-A7"
  ],
  ["A20", "Each persisted artifact carries a non-empty `promptHash` and `skillIds[]`.", "integration", "P4-A4"],
  ["A21", "A non-allowlisted plugin is refused at worker boot.", "integration", "P6-A4"],
  [
    "A22",
    "An allowlisted plugin contributing a capability, a skill, a tool, and a release gate loads end-to-end.",
    "integration",
    "P6-A3"
  ],
  [
    "A23",
    "A prompt assembled by the runner contains all seven required blocks in the Section 4A.4 order.",
    "unit",
    "P4-A5"
  ],
  [
    "A24",
    "An agent that emits text outside the artifact JSON/Markdown contract fails the activity.",
    "integration",
    "P4-A1"
  ],
  ["A25", "An instruction embedded in a tool output is treated as data and not acted on.", "integration", "P4-A1"]
];

function rowFor(id: string): string {
  return matrix.split(/\r?\n/).find((line) => line.startsWith(`| ${id} `)) || "";
}

describe("acceptance matrix traceability", () => {
  it("mirrors spec Section 18 behaviors, types, and phase IDs", () => {
    for (const [id, behavior, type, phaseIds] of expectedRows) {
      const row = rowFor(id);
      const cells = row.split("|").map((cell) => cell.trim());

      expect(row, `${id} row is missing`).not.toBe("");
      expect(cells[2], `${id} behavior drifted from spec`).toBe(behavior);
      expect(cells[3], `${id} type drifted from spec`).toBe(type);
      expect(cells[4], `${id} phase IDs drifted from spec`).toBe(phaseIds);
      expect(cells[5], `${id} evidence is missing`).toContain("`");
      expect(cells[6], `${id} command is missing`).toMatch(/^`npm /);
    }
  });
});
