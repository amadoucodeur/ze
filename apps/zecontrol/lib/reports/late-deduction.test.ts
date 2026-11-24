import { describe, expect, it } from "vitest";
import { computeLateDeduction, MONTHLY_WORK_MINUTES } from "./late-deduction";

describe("computeLateDeduction", () => {
  it("uses a 9 600 minute monthly base", () => {
    expect(MONTHLY_WORK_MINUTES).toBe(9600);
  });

  it("reproduces the reference example (200 000 FCFA, 1 h 35 de retard)", () => {
    const result = computeLateDeduction(200_000, 95);
    expect(result?.minuteCost).toBeCloseTo(20.8333, 4);
    expect(result?.deduction).toBe(1979);
    expect(result?.netAfterDeduction).toBe(198_021);
  });

  it("returns no deduction without lateness", () => {
    expect(computeLateDeduction(200_000, 0)).toMatchObject({ deduction: 0, netAfterDeduction: 200_000 });
  });

  it("returns null when no salary is configured", () => {
    expect(computeLateDeduction(null, 95)).toBeNull();
  });

  it("never deducts more than the salary", () => {
    expect(computeLateDeduction(9600, 20_000)).toMatchObject({ deduction: 9600, netAfterDeduction: 0 });
  });
});
