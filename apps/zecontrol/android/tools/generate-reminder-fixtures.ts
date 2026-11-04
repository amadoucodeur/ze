// Generates the parity fixtures from the website's real TypeScript reminder
// logic. Run with `bun tools/generate-reminder-fixtures.ts` after changing
// lib/work-policy-evaluation.ts, then run `./gradlew testDebugUnitTest`.
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentWorkPolicyReminder, type EvaluatedClockingEvent } from "../../lib/work-policy-evaluation";
import { defaultWorkPolicies, defaultWorkReminderSettings, type WorkPolicyDefinition } from "../../lib/work-policy";

const zones = ["Africa/Abidjan", "Europe/Paris", "America/New_York"];
const day = "2026-11-04"; // A Wednesday.

const base = defaultWorkPolicies.fixed;
const definitions: Record<string, WorkPolicyDefinition> = {
  standard: base,
  noFollowUp: { ...base, reminders: { ...defaultWorkReminderSettings, followUpEnabled: false } },
  custom: {
    ...base,
    startTime: "07:30",
    endTime: "16:15",
    breakMinutes: 45,
    toleranceMinutes: 3,
    minimumBreakAfterMinutes: 240,
    reminders: { ...defaultWorkReminderSettings, warningPercent: 70, arrivalLeadMinutes: 45 },
  },
  daySchedule: {
    ...base,
    daySchedules: { "3": { startTime: "10:00", endTime: "14:00", breakMinutes: 20 } },
  },
  dayOff: { ...base, days: [1, 2, 4, 5] },
  noArrival: { ...base, reminders: { ...defaultWorkReminderSettings, arrivalEnabled: false } },
  noDeparture: { ...base, reminders: { ...defaultWorkReminderSettings, departureEnabled: false } },
  noBreaks: { ...base, reminders: { ...defaultWorkReminderSettings, breakDueEnabled: false, breakEndEnabled: false } },
  disabled: { ...base, reminders: { ...defaultWorkReminderSettings, enabled: false } },
  flexible: defaultWorkPolicies.flexible,
  attendance: defaultWorkPolicies.attendance,
};

function at(zoneOffsetMinutes: number, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const utc = Date.UTC(2026, 10, 4, hours, minutes) - zoneOffsetMinutes * 60_000;
  return new Date(utc + 17_000).toISOString(); // Seconds exercise the floors.
}

const offsets: Record<string, number> = { "Africa/Abidjan": 0, "Europe/Paris": 60, "America/New_York": -300 };
const sequences: Record<string, [EvaluatedClockingEvent["type"], string][]> = {
  none: [],
  working: [["start", "08:03"]],
  late: [["start", "09:40"]],
  onBreak: [["start", "08:00"], ["break", "12:30"]],
  resumed: [["start", "08:00"], ["break", "12:00"], ["resume", "13:00"]],
  secondBreak: [["start", "08:00"], ["break", "12:00"], ["resume", "13:00"], ["break", "15:00"]],
  finished: [["start", "08:00"], ["end", "17:02"]],
};

const cases = [];
for (const timeZone of zones) {
  for (const [definitionName, definition] of Object.entries(definitions)) {
    for (const [sequenceName, sequence] of Object.entries(sequences)) {
      const events = sequence.map(([type, time]) => ({
        type,
        event_status: "accepted" as const,
        pointed_at: at(offsets[timeZone], time),
      }));
      const expected = [];
      for (let minute = 0; minute < 24 * 60; minute += 1) {
        const hh = String(Math.floor(minute / 60)).padStart(2, "0");
        const mm = String(minute % 60).padStart(2, "0");
        const instant = at(offsets[timeZone], `${hh}:${mm}`);
        const now = new Date(instant);
        const eventsSoFar = events.filter((event) => event.pointed_at <= instant);
        const reminder = currentWorkPolicyReminder({ definition, events: eventsSoFar, now, timeZone });
        expected.push(reminder ? [minute, reminder.key, reminder.title, reminder.message] : null);
      }
      cases.push({
        name: `${timeZone}/${definitionName}/${sequenceName}`,
        timeZone,
        definition,
        events: events.map((event) => ({ type: event.type, at: +new Date(event.pointed_at) })),
        startMs: +new Date(at(offsets[timeZone], "00:00")),
        expected: expected.filter(Boolean),
      });
    }
  }
}

const target = join(dirname(fileURLToPath(import.meta.url)), "../app/src/test/resources/reminder-parity.json.gz");
writeFileSync(target, gzipSync(JSON.stringify({ day, cases }), { level: 9 }));
console.log(`${cases.length} scenarios × 1440 minutes written to ${target}`);
