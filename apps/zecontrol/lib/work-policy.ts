export type WorkPolicyMode = "fixed" | "flexible" | "attendance";

export type WorkDaySchedule = {
  startTime: string;
  endTime: string;
  breakMinutes: number;
};

export type WorkReminderSettings = {
  enabled: boolean;
  arrivalEnabled: boolean;
  breakDueEnabled: boolean;
  breakEndEnabled: boolean;
  followUpEnabled: boolean;
  warningPercent: number;
  arrivalLeadMinutes: number;
  repeatMinutes: number;
};

export const defaultWorkReminderSettings: WorkReminderSettings = {
  enabled: true,
  arrivalEnabled: true,
  breakDueEnabled: true,
  breakEndEnabled: true,
  followUpEnabled: true,
  warningPercent: 85,
  arrivalLeadMinutes: 60,
  repeatMinutes: 15,
};

export type WorkPolicyDefinition = {
  mode: WorkPolicyMode;
  days: number[];
  startTime: string;
  endTime: string;
  daySchedules: Record<string, WorkDaySchedule>;
  weeklyTargetMinutes: number;
  breakMinutes: number;
  breakOverrunDeductionEnabled?: boolean;
  toleranceMinutes: number;
  roundingMinutes: 0 | 5 | 10 | 15;
  overtimeEnabled: boolean;
  overtimeApprovalRequired: boolean;
  minimumRestMinutes: number;
  minimumBreakAfterMinutes: number;
  unclosedDayPenaltyMinutes?: number;
  reminders?: Partial<WorkReminderSettings>;
};

export const DEFAULT_UNCLOSED_DAY_PENALTY_MINUTES = 30;

export const weekdayOptions = [
  { value: 1, short: "L", label: "Lundi" },
  { value: 2, short: "M", label: "Mardi" },
  { value: 3, short: "M", label: "Mercredi" },
  { value: 4, short: "J", label: "Jeudi" },
  { value: 5, short: "V", label: "Vendredi" },
  { value: 6, short: "S", label: "Samedi" },
  { value: 7, short: "D", label: "Dimanche" },
] as const;

export const defaultWorkPolicies: Record<WorkPolicyMode, WorkPolicyDefinition> = {
  fixed: {
    mode: "fixed",
    days: [1, 2, 3, 4, 5],
    startTime: "08:00",
    endTime: "17:00",
    daySchedules: {},
    weeklyTargetMinutes: 2400,
    breakMinutes: 60,
    breakOverrunDeductionEnabled: false,
    toleranceMinutes: 10,
    roundingMinutes: 0,
    overtimeEnabled: true,
    overtimeApprovalRequired: true,
    minimumRestMinutes: 660,
    minimumBreakAfterMinutes: 360,
    unclosedDayPenaltyMinutes: DEFAULT_UNCLOSED_DAY_PENALTY_MINUTES,
    reminders: { ...defaultWorkReminderSettings },
  },
  flexible: {
    mode: "flexible",
    days: [1, 2, 3, 4, 5],
    startTime: "09:00",
    endTime: "17:00",
    daySchedules: {},
    weeklyTargetMinutes: 2400,
    breakMinutes: 60,
    breakOverrunDeductionEnabled: false,
    toleranceMinutes: 0,
    roundingMinutes: 0,
    overtimeEnabled: true,
    overtimeApprovalRequired: true,
    minimumRestMinutes: 660,
    minimumBreakAfterMinutes: 360,
    unclosedDayPenaltyMinutes: 0,
    reminders: {
      ...defaultWorkReminderSettings,
      enabled: false,
      arrivalEnabled: false,
    },
  },
  attendance: {
    mode: "attendance",
    days: [],
    startTime: "08:00",
    endTime: "17:00",
    daySchedules: {},
    weeklyTargetMinutes: 0,
    breakMinutes: 0,
    breakOverrunDeductionEnabled: false,
    toleranceMinutes: 0,
    roundingMinutes: 0,
    overtimeEnabled: false,
    overtimeApprovalRequired: false,
    minimumRestMinutes: 0,
    minimumBreakAfterMinutes: 0,
    unclosedDayPenaltyMinutes: 0,
    reminders: {
      ...defaultWorkReminderSettings,
      enabled: false,
      arrivalEnabled: false,
      breakDueEnabled: false,
      breakEndEnabled: false,
    },
  },
};

export function workReminderSettings(
  definition: WorkPolicyDefinition,
): WorkReminderSettings {
  return {
    ...defaultWorkReminderSettings,
    ...definition.reminders,
  };
}

export function unclosedDayPenaltyMinutes(
  definition: WorkPolicyDefinition,
) {
  const configured = definition.unclosedDayPenaltyMinutes;
  if (configured === undefined) {
    return definition.mode === "fixed"
      ? DEFAULT_UNCLOSED_DAY_PENALTY_MINUTES
      : 0;
  }
  return Math.max(0, Math.min(720, Math.round(configured)));
}

export function areWorkReminderSettingsValid(
  definition: WorkPolicyDefinition,
) {
  const settings = workReminderSettings(definition);
  return (
    Number.isFinite(settings.warningPercent) &&
    settings.warningPercent >= 50 &&
    settings.warningPercent <= 95 &&
    Number.isFinite(settings.arrivalLeadMinutes) &&
    settings.arrivalLeadMinutes >= 15 &&
    settings.arrivalLeadMinutes <= 180 &&
    Number.isFinite(settings.repeatMinutes) &&
    settings.repeatMinutes >= 5 &&
    settings.repeatMinutes <= 60
  );
}

export function isWorkPolicyDefinition(value: unknown): value is WorkPolicyDefinition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkPolicyDefinition>;
  return (
    ["fixed", "flexible", "attendance"].includes(candidate.mode ?? "") &&
    Array.isArray(candidate.days) &&
    candidate.days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7) &&
    typeof candidate.startTime === "string" &&
    typeof candidate.endTime === "string" &&
    (candidate.daySchedules === undefined ||
      (typeof candidate.daySchedules === "object" &&
        candidate.daySchedules !== null)) &&
    typeof candidate.weeklyTargetMinutes === "number" &&
    typeof candidate.breakMinutes === "number" &&
    (candidate.breakOverrunDeductionEnabled === undefined ||
      typeof candidate.breakOverrunDeductionEnabled === "boolean") &&
    typeof candidate.toleranceMinutes === "number" &&
    [0, 5, 10, 15].includes(candidate.roundingMinutes ?? -1) &&
    typeof candidate.overtimeEnabled === "boolean" &&
    typeof candidate.overtimeApprovalRequired === "boolean" &&
    typeof candidate.minimumRestMinutes === "number" &&
    typeof candidate.minimumBreakAfterMinutes === "number" &&
    (candidate.unclosedDayPenaltyMinutes === undefined ||
      (typeof candidate.unclosedDayPenaltyMinutes === "number" &&
        Number.isFinite(candidate.unclosedDayPenaltyMinutes) &&
        candidate.unclosedDayPenaltyMinutes >= 0 &&
        candidate.unclosedDayPenaltyMinutes <= 720)) &&
    (
      candidate.reminders === undefined ||
      (
        typeof candidate.reminders === "object" &&
        candidate.reminders !== null &&
        (candidate.reminders.enabled === undefined ||
          typeof candidate.reminders.enabled === "boolean") &&
        (candidate.reminders.arrivalEnabled === undefined ||
          typeof candidate.reminders.arrivalEnabled === "boolean") &&
        (candidate.reminders.breakDueEnabled === undefined ||
          typeof candidate.reminders.breakDueEnabled === "boolean") &&
        (candidate.reminders.breakEndEnabled === undefined ||
          typeof candidate.reminders.breakEndEnabled === "boolean") &&
        (candidate.reminders.followUpEnabled === undefined ||
          typeof candidate.reminders.followUpEnabled === "boolean") &&
        (candidate.reminders.warningPercent === undefined ||
          typeof candidate.reminders.warningPercent === "number") &&
        (candidate.reminders.arrivalLeadMinutes === undefined ||
          typeof candidate.reminders.arrivalLeadMinutes === "number") &&
        (candidate.reminders.repeatMinutes === undefined ||
          typeof candidate.reminders.repeatMinutes === "number")
      )
    )
  );
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function scheduleForDay(
  definition: WorkPolicyDefinition,
  day: number,
): WorkDaySchedule | null {
  if (!definition.days.includes(day) || definition.mode === "attendance") return null;
  const override = definition.daySchedules?.[String(day)];
  return override ?? {
    startTime: definition.startTime,
    endTime: definition.endTime,
    breakMinutes: definition.breakMinutes,
  };
}

export function scheduledMinutes(schedule: WorkDaySchedule) {
  const start = minutesFromTime(schedule.startTime);
  let end = minutesFromTime(schedule.endTime);
  if (end <= start) end += 24 * 60;
  return Math.max(0, end - start - schedule.breakMinutes);
}

export function fixedDailyMinutes(definition: WorkPolicyDefinition) {
  if (definition.mode !== "fixed") return 0;
  return scheduledMinutes({
    startTime: definition.startTime,
    endTime: definition.endTime,
    breakMinutes: definition.breakMinutes,
  });
}

export function formatMinutes(total: number) {
  const safeTotal = Math.max(0, Math.round(total));
  const hours = Math.floor(safeTotal / 60);
  const minutes = safeTotal % 60;
  if (!minutes) return `${hours} h`;
  return `${hours} h ${String(minutes).padStart(2, "0")}`;
}

export function policySummary(definition: WorkPolicyDefinition) {
  if (definition.mode === "attendance") {
    return "ZeControl enregistrera les présences sans imposer d’horaire ni de durée attendue.";
  }

  const selectedDays = weekdayOptions
    .filter((day) => definition.days.includes(day.value))
    .map((day) => day.label.toLowerCase());
  const daysLabel =
    selectedDays.length === 5 && definition.days.every((day) => day >= 1 && day <= 5)
      ? "du lundi au vendredi"
      : selectedDays.length === 1
        ? `le ${selectedDays[0]}`
        : `les ${selectedDays.join(", ")}`;

  if (definition.mode === "flexible") {
    return `Horaires flexibles ${daysLabel}, avec ${formatMinutes(definition.weeklyTargetMinutes)} attendues par semaine.`;
  }

  const hasCustomDays = definition.days.some((day) => definition.daySchedules?.[String(day)]);
  if (hasCustomDays) {
    const weeklyMinutes = definition.days.reduce((total, day) => {
      const schedule = scheduleForDay(definition, day);
      return total + (schedule ? scheduledMinutes(schedule) : 0);
    }, 0);
    return `Les horaires varient selon les jours sélectionnés, pour un total prévu de ${formatMinutes(weeklyMinutes)} par semaine.`;
  }

  const dailyMinutes = fixedDailyMinutes(definition);
  return `Travail ${daysLabel}, de ${definition.startTime} à ${definition.endTime}, avec ${formatMinutes(definition.breakMinutes)} de pause. Soit ${formatMinutes(dailyMinutes * definition.days.length)} par semaine.`;
}
