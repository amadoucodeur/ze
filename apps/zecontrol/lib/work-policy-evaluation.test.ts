import { describe, expect, it } from "vitest";
import { defaultWorkPolicies } from "./work-policy";
import {
  currentWorkPolicyMessage,
  currentWorkPolicyReminder,
  evaluateWorkday,
} from "./work-policy-evaluation";

const definition = {
  ...defaultWorkPolicies.fixed,
  days: [1, 2, 3, 4, 5, 6, 7],
  roundingMinutes: 5 as const,
};
const events = [
  { type: "start" as const, event_status: "accepted" as const, pointed_at: "2026-08-31T08:03:00.000Z" },
  { type: "end" as const, event_status: "accepted" as const, pointed_at: "2026-08-31T18:02:00.000Z" },
];

describe("evaluateWorkday advanced rules", () => {
  it("rounds pointages and counts overtime even while approval is pending", () => {
    const result = evaluateWorkday({
      definition,
      events,
      date: "2026-08-31",
      now: new Date("2026-09-01T10:00:00.000Z"),
      timeZone: "Africa/Abidjan",
    });
    expect(result.workedMinutes).toBe(595);
    expect(result.rawOvertimeMinutes).toBe(115);
    expect(result.overtimeMinutes).toBe(115);
    expect(result.overtimeApprovalStatus).toBe("pending");
  });

  it("counts approved overtime", () => {
    const result = evaluateWorkday({
      definition,
      events,
      date: "2026-08-31",
      now: new Date("2026-09-01T10:00:00.000Z"),
      timeZone: "Africa/Abidjan",
      overtimeReviewStatus: "approved",
    });
    expect(result.overtimeMinutes).toBe(115);
    expect(result.overtimeApprovalStatus).toBe("approved");
  });

  it("keeps rejected overtime detected while the report records the decision", () => {
    const result = evaluateWorkday({
      definition: { ...definition, overtimeEnabled: false },
      events,
      date: "2026-08-31",
      now: new Date("2026-09-01T10:00:00.000Z"),
      timeZone: "Africa/Abidjan",
      overtimeReviewStatus: "rejected",
    });
    expect(result.overtimeMinutes).toBe(115);
    expect(result.overtimeApprovalStatus).toBe("rejected");
  });

  it("keeps break overrun separate from start-of-service lateness", () => {
    const result = evaluateWorkday({
      definition: { ...definition, roundingMinutes: 0 },
      events: [
        { type: "start", event_status: "accepted", pointed_at: "2026-08-31T08:00:00.000Z" },
        { type: "break", event_status: "accepted", pointed_at: "2026-08-31T12:00:00.000Z" },
        { type: "resume", event_status: "accepted", pointed_at: "2026-08-31T13:30:00.000Z" },
        { type: "end", event_status: "accepted", pointed_at: "2026-08-31T17:00:00.000Z" },
      ],
      date: "2026-08-31",
      now: new Date("2026-09-01T10:00:00.000Z"),
      timeZone: "Africa/Abidjan",
    });
    expect(result.arrivalLateMinutes).toBe(0);
    expect(result.lateMinutes).toBe(0);
    expect(result.breakOverrunMinutes).toBe(30);
  });

  it("shows break overrun without deducting it from the balance by default", () => {
    const result = evaluateWorkday({
      definition: { ...definition, roundingMinutes: 0, breakOverrunDeductionEnabled: false },
      events: [
        { type: "start", event_status: "accepted", pointed_at: "2026-08-31T08:00:00.000Z" },
        { type: "break", event_status: "accepted", pointed_at: "2026-08-31T12:00:00.000Z" },
        { type: "resume", event_status: "accepted", pointed_at: "2026-08-31T13:30:00.000Z" },
        { type: "end", event_status: "accepted", pointed_at: "2026-08-31T17:00:00.000Z" },
      ],
      date: "2026-08-31",
      now: new Date("2026-09-01T10:00:00.000Z"),
      timeZone: "Africa/Abidjan",
    });
    expect(result.workedMinutes).toBe(450);
    expect(result.breakOverrunMinutes).toBe(30);
    expect(result.lateMinutes).toBe(0);
    expect(result.differenceMinutes).toBe(0);
  });

  it("deducts a break overrun only when configured", () => {
    const result = evaluateWorkday({
      definition: { ...definition, roundingMinutes: 0, breakOverrunDeductionEnabled: true },
      events: [
        { type: "start", event_status: "accepted", pointed_at: "2026-08-31T08:00:00.000Z" },
        { type: "break", event_status: "accepted", pointed_at: "2026-08-31T12:00:00.000Z" },
        { type: "resume", event_status: "accepted", pointed_at: "2026-08-31T13:30:00.000Z" },
        { type: "end", event_status: "accepted", pointed_at: "2026-08-31T17:00:00.000Z" },
      ],
      date: "2026-08-31",
      now: new Date("2026-09-01T10:00:00.000Z"),
      timeZone: "Africa/Abidjan",
    });
    expect(result.workedMinutes).toBe(450);
    expect(result.breakOverrunMinutes).toBe(30);
    expect(result.differenceMinutes).toBe(-30);
  });
});

describe("currentWorkPolicyReminder", () => {
  it("reminds an agent to clock out after the scheduled end", () => {
    const reminder = currentWorkPolicyReminder({
      definition: { ...definition, roundingMinutes: 0 },
      events: [
        {
          type: "start",
          event_status: "accepted",
          pointed_at: "2026-08-31T08:00:00.000Z",
        },
      ],
      now: new Date("2026-08-31T17:12:00.000Z"),
      timeZone: "Africa/Abidjan",
    });

    expect(reminder?.key).toBe("departure-overdue-0");
    expect(reminder?.title).toBe("Départ non pointé depuis 12 min");
  });

  it("does not remind an agent who already clocked out", () => {
    const reminder = currentWorkPolicyReminder({
      definition: { ...definition, roundingMinutes: 0 },
      events,
      now: new Date("2026-08-31T18:12:00.000Z"),
      timeZone: "Africa/Abidjan",
    });

    expect(reminder).toBeNull();
  });

  it("respects the departure reminder setting", () => {
    const reminder = currentWorkPolicyReminder({
      definition: {
        ...definition,
        roundingMinutes: 0,
        reminders: {
          ...defaultWorkPolicies.fixed.reminders,
          breakDueEnabled: false,
          breakEndEnabled: false,
          departureEnabled: false,
        },
      },
      events: [
        {
          type: "start",
          event_status: "accepted",
          pointed_at: "2026-08-31T08:00:00.000Z",
        },
      ],
      now: new Date("2026-08-31T17:12:00.000Z"),
      timeZone: "Africa/Abidjan",
    });

    expect(reminder).toBeNull();
  });
});

describe("currentWorkPolicyMessage", () => {
  it("makes departure the recommended action after the scheduled end", () => {
    const message = currentWorkPolicyMessage({
      definition: { ...definition, roundingMinutes: 0 },
      events: [
        {
          type: "start",
          event_status: "accepted",
          pointed_at: "2026-08-31T08:00:00.000Z",
        },
      ],
      now: new Date("2026-08-31T17:12:00.000Z"),
      timeZone: "Africa/Abidjan",
    });

    expect(message?.recommendedAction).toBe("end");
  });

  it("still recommends departure when the agent is on pause", () => {
    const message = currentWorkPolicyMessage({
      definition: { ...definition, roundingMinutes: 0 },
      events: [
        {
          type: "start",
          event_status: "accepted",
          pointed_at: "2026-08-31T08:00:00.000Z",
        },
        {
          type: "break",
          event_status: "accepted",
          pointed_at: "2026-08-31T16:50:00.000Z",
        },
      ],
      now: new Date("2026-08-31T17:12:00.000Z"),
      timeZone: "Africa/Abidjan",
    });

    expect(message?.recommendedAction).toBe("end");
  });
});
