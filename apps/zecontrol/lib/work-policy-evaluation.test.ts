import { describe, expect, it } from "vitest";
import { defaultWorkPolicies } from "./work-policy";
import {
  currentWorkPolicyMessage,
  currentWorkPolicyReminder,
  evaluateWorkday,
  reminderSlot,
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
  const nightShift = {
    ...defaultWorkPolicies.fixed,
    days: [1, 2, 3, 4, 5, 6, 7],
    startTime: "22:00",
    endTime: "06:00",
  };

  it("does not report a missing arrival during the morning before a night shift", () => {
    expect(currentWorkPolicyReminder({
      definition: nightShift,
      events: [],
      now: new Date("2026-11-04T03:00:00.000Z"),
      timeZone: "Africa/Abidjan",
    })).toBeNull();
  });

  it("still reports the night shift departure after a clock event past midnight", () => {
    expect(currentWorkPolicyReminder({
      definition: nightShift,
      events: [{ type: "resume", event_status: "accepted", pointed_at: "2026-11-04T01:00:00.000Z" }],
      now: new Date("2026-11-04T06:00:00.000Z"),
      timeZone: "Africa/Abidjan",
    })?.title).toBe("C’est l’heure de terminer");
  });

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

    expect(reminder?.key).toBe("departure-followup-10");
    expect(reminder?.title).toBe("Départ non pointé depuis 12 min");
  });

  it("spaces out departure follow-ups, then goes quiet", () => {
    const keys = new Set<string>();
    const firstSeen: number[] = [];
    for (let minute = 0; minute < 7 * 60; minute += 1) {
      const reminder = currentWorkPolicyReminder({
        definition: { ...definition, roundingMinutes: 0 },
        events: [
          { type: "start", event_status: "accepted", pointed_at: "2026-08-31T08:00:00.000Z" },
          { type: "break", event_status: "accepted", pointed_at: "2026-08-31T12:00:00.000Z" },
          { type: "resume", event_status: "accepted", pointed_at: "2026-08-31T13:00:00.000Z" },
        ],
        now: new Date(Date.UTC(2026, 7, 31, 17, minute)),
        timeZone: "Africa/Abidjan",
      });
      if (reminder && !keys.has(reminder.key)) {
        keys.add(reminder.key);
        firstSeen.push(minute);
      }
    }
    expect(firstSeen).toEqual([0, 10, 30, 60, 120, 240]);
  });

  it("stops asking for an arrival two hours after the start", () => {
    const at = (hour: number) => currentWorkPolicyReminder({
      definition: { ...definition, roundingMinutes: 0 },
      events: [],
      now: new Date(Date.UTC(2026, 7, 31, hour)),
      timeZone: "Africa/Abidjan",
    });
    expect(at(10)?.key).toBe("arrival-followup-120");
    expect(at(10)?.title).toBe("Arrivée non pointée depuis 2 h");
    expect(at(15)?.key).toBe("arrival-followup-120");
  });

  it("shows only one reminder once when follow-ups are disabled", () => {
    const reminder = currentWorkPolicyReminder({
      definition: {
        ...definition,
        roundingMinutes: 0,
        reminders: { ...defaultWorkPolicies.fixed.reminders, followUpEnabled: false },
      },
      events: [],
      now: new Date(Date.UTC(2026, 7, 31, 11)),
      timeZone: "Africa/Abidjan",
    });
    expect(reminder?.key).toBe("arrival-100");
  });

  it("gives every step of a reminder the same notification slot", () => {
    expect(reminderSlot("arrival-warning-85")).toBe("arrival");
    expect(reminderSlot("arrival-100")).toBe("arrival");
    expect(reminderSlot("pause-end-followup-30")).toBe("pause-end");
    expect(reminderSlot("pause-end-warning-87.5")).toBe("pause-end");
  });

  it("never notifies about taking a break", () => {
    for (let hour = 8; hour < 17; hour += 1) {
      expect(currentWorkPolicyReminder({
        definition: { ...definition, roundingMinutes: 0 },
        events: [{ type: "start", event_status: "accepted", pointed_at: "2026-08-31T08:00:00.000Z" }],
        now: new Date(Date.UTC(2026, 7, 31, hour, 30)),
        timeZone: "Africa/Abidjan",
      })).toBeNull();
    }
  });

  describe("forgotten departure penalty", () => {
    const departure = (
      penalty: number | undefined,
      last: "start" | "break" = "start",
    ) => currentWorkPolicyReminder({
      definition: { ...definition, roundingMinutes: 0, unclosedDayPenaltyMinutes: penalty },
      events: [{ type: last, event_status: "accepted", pointed_at: "2026-08-31T08:00:00.000Z" }],
      now: new Date("2026-08-31T17:10:00.000Z"),
      timeZone: "Africa/Abidjan",
    })?.message;

    it("states the configured penalty", () => {
      expect(departure(30)).toContain("retire 30 min de votre temps de travail");
      expect(departure(90)).toContain("retire 1 h 30 de votre temps de travail");
    });

    it("uses the default penalty of a fixed schedule", () => {
      expect(departure(undefined)).toContain("retire 30 min");
    });

    it("mentions nothing when there is no penalty", () => {
      expect(departure(0)).toBe("Si votre journée est terminée, pensez à pointer votre départ.");
    });

    it("mentions nothing when the day would close at a break, without penalty", () => {
      expect(departure(30, "break")).toBe("Si votre journée est terminée, pensez à pointer votre départ.");
    });
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
