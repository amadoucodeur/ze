import { describe, expect, it } from "vitest";
import { zonedDateTime } from "./period";

describe("zonedDateTime form inputs", () => {
  it.each(["2026-09-14T", "2026-09-14T17", "2026-09-14T17:", "T17:00"])(
    "returns an invalid date without crashing for incomplete input %s",
    (input) => {
      expect(Number.isNaN(zonedDateTime(input, "Africa/Abidjan").getTime())).toBe(true);
    },
  );

  it("converts a completed departure time in the organisation timezone", () => {
    expect(zonedDateTime("2026-09-14T17:30", "Africa/Abidjan").toISOString())
      .toBe("2026-09-14T17:30:00.000Z");
    expect(zonedDateTime("2026-09-14T17:30", "Asia/Kolkata").toISOString())
      .toBe("2026-09-14T12:00:00.000Z");
  });
});
