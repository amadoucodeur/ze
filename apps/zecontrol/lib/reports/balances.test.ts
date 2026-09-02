import { describe, expect, it } from "vitest";
import { isBalanceEligibleDay } from "./balances";

describe("isBalanceEligibleDay", () => {
  it("includes a past planned absence in balances", () => {
    expect(isBalanceEligibleDay({
      isPotentialAbsence: true,
      evaluation: { automaticClosure: "none" },
    })).toBe(true);
  });

  it("excludes a future incomplete day", () => {
    expect(isBalanceEligibleDay({
      isPotentialAbsence: false,
      evaluation: { automaticClosure: "none" },
    })).toBe(false);
  });
});
