import { describe, expect, it } from "vitest";
import { canRunWhenControlPaused } from "../scripts/preflight-policy.mjs";

describe("preflight pause policy", () => {
  it("lets control-plane lanes run while the control plane is paused", () => {
    expect(canRunWhenControlPaused("research")).toBe(true);
    expect(canRunWhenControlPaused("0")).toBe(true);
    expect(canRunWhenControlPaused(0)).toBe(true);
    expect(canRunWhenControlPaused("r&d")).toBe(true);
    expect(canRunWhenControlPaused("meta-health")).toBe(true);
    expect(canRunWhenControlPaused("  META-HEALTH  ")).toBe(true);
    expect(canRunWhenControlPaused("7")).toBe(true);
    expect(canRunWhenControlPaused("janitor")).toBe(true);
    expect(canRunWhenControlPaused("8")).toBe(true);
    expect(canRunWhenControlPaused("backend-core")).toBe(false);
    expect(canRunWhenControlPaused("captain")).toBe(false);
  });
});
