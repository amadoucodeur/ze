import { describe, expect, it } from "vitest";
import {
  missingClockingOptions,
  pendingClockingRequestEvents,
  previousOpenClockingDay,
} from "./clocking-sequence";

const timeZone = "Africa/Abidjan";

describe("previousOpenClockingDay", () => {
  it("returns the last unfinished previous day", () => {
    const result = previousOpenClockingDay(
      [
        { id: "start", type: "start", pointed_at: "2026-09-02T08:00:00.000Z" },
      ],
      "2026-09-03",
      timeZone,
    );

    expect(result?.day).toBe("2026-09-02");
    expect(result?.last.type).toBe("start");
  });

  it("does not block today when yesterday's closure is pending", () => {
    const result = previousOpenClockingDay(
      [
        { id: "start", type: "start", pointed_at: "2026-09-02T08:00:00.000Z" },
      ],
      "2026-09-03",
      timeZone,
      ["2026-09-02"],
    );

    expect(result).toBeNull();
  });

  it("does not flag a previous day that already has a departure", () => {
    const result = previousOpenClockingDay(
      [
        { id: "start", type: "start", pointed_at: "2026-09-02T08:00:00.000Z" },
        { id: "end", type: "end", pointed_at: "2026-09-02T17:00:00.000Z" },
      ],
      "2026-09-03",
      timeZone,
    );

    expect(result).toBeNull();
  });
});

describe("pendingClockingRequestEvents", () => {
  it("turns several pending requests into one provisional chronology", () => {
    const events = pendingClockingRequestEvents([
      {
        id: "arrival-request",
        request_kind: "missing_event",
        requested_type: "start",
        requested_pointed_at: "2026-09-01T08:00:00.000Z",
        requested_end_at: null,
      },
      {
        id: "break-request",
        request_kind: "missing_break",
        requested_type: "break",
        requested_pointed_at: "2026-09-01T12:00:00.000Z",
        requested_end_at: "2026-09-01T13:00:00.000Z",
      },
      {
        id: "departure-request",
        request_kind: "missing_event",
        requested_type: "end",
        requested_pointed_at: "2026-09-01T17:00:00.000Z",
        requested_end_at: null,
      },
    ]);

    expect(events.map((event) => event.type)).toEqual([
      "start",
      "break",
      "resume",
      "end",
    ]);
    expect(events.every((event) => event.provisional)).toBe(true);
  });

  it("offers the next requests before the first one is approved", () => {
    const provisionalArrival = pendingClockingRequestEvents([
      {
        id: "arrival-request",
        request_kind: "missing_event",
        requested_type: "start",
        requested_pointed_at: "2026-09-01T08:00:00.000Z",
        requested_end_at: null,
      },
    ]);

    expect(
      missingClockingOptions(provisionalArrival)
        .filter((option) => option.kind === "single")
        .map((option) => option.type),
    ).toEqual(["break", "end"]);
  });
});
