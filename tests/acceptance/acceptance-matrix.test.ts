import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const matrix = readFileSync("docs/acceptance-matrix.md", "utf8");
const requiredIds = Array.from({ length: 25 }, (_, index) => `A${String(index + 1).padStart(2, "0")}`);

function rowFor(id: string): string {
  return matrix.split(/\r?\n/).find((line) => line.startsWith(`| ${id} `)) || "";
}

describe("acceptance matrix traceability", () => {
  it("covers A01-A25 with evidence and commands", () => {
    for (const id of requiredIds) {
      const row = rowFor(id);
      const cells = row.split("|").map((cell) => cell.trim());

      expect(row, `${id} row is missing`).not.toBe("");
      expect(cells[3], `${id} evidence is missing`).toContain("`");
      expect(cells[4].replaceAll("`", ""), `${id} command is missing`).toMatch(/^(npm|docker) /);
    }
  });
});
