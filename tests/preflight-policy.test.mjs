import { describe, expect, it } from "vitest";
import { canRunWhenControlPaused } from "../scripts/preflight-policy.mjs";

describe("preflight pause policy", () => {
  it("lets only Meta Health run while the control plane is paused", () => {
    expect(canRunWhenControlPaused("meta-health")).toBe(true);
    expect(canRunWhenControlPaused("  META-HEALTH  ")).toBe(true);
    expect(canRunWhenControlPaused("backend-core")).toBe(false);
    expect(canRunWhenControlPaused("janitor")).toBe(false);
    expect(canRunWhenControlPaused("captain")).toBe(false);
  });
});
