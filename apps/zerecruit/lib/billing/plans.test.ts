import { describe, expect, it } from "vitest";
import {
  PLAN_CATALOG,
  formatXof,
  getPaidPlan,
  getPlan,
  getPlanPrice,
  hasActivePlanAccess,
} from "./plans";

describe("ZeRecruit Plans & Billing", () => {
  it("contains all expected plans in catalog", () => {
    const codes = PLAN_CATALOG.map((p) => p.code);
    expect(codes).toEqual(["free", "essential", "team", "scale"]);
  });

  it("retrieves the right plan by code or falls back to free", () => {
    expect(getPlan("team").name).toBe("Équipe");
    expect(getPlan("non-existent").code).toBe("free");
    expect(getPlan(null).code).toBe("free");
  });

  it("identifies paid plans eligible for self-service checkout", () => {
    expect(getPaidPlan("essential")?.code).toBe("essential");
    expect(getPaidPlan("team")?.code).toBe("team");
    expect(getPaidPlan("free")).toBeNull();
    expect(getPaidPlan("scale")).toBeNull();
  });

  it("calculates plan price according to billing cycle", () => {
    const essential = getPlan("essential");
    expect(getPlanPrice(essential, "month")).toBe(9_000);
    expect(getPlanPrice(essential, "year")).toBe(90_000);
  });

  it("formats XOF currency correctly", () => {
    expect(formatXof(90000)).toMatch(/90[\s\u202f]000/);
  });

  it("evaluates plan access status correctly", () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const pastDate = new Date(Date.now() - 86400000).toISOString();

    expect(
      hasActivePlanAccess({
        plan: "team",
        plan_expires_at: futureDate,
        billing_status: "active",
      }),
    ).toBe(true);

    expect(
      hasActivePlanAccess({
        plan: "team",
        plan_expires_at: pastDate,
        billing_status: "active",
      }),
    ).toBe(false);

    expect(
      hasActivePlanAccess({
        plan: "team",
        plan_expires_at: futureDate,
        billing_status: "suspended",
      }),
    ).toBe(false);
  });
});
