import {
  scheduleForDay,
  scheduledMinutes,
  unclosedDayPenaltyMinutes,
  workReminderSettings,
  type WorkPolicyDefinition,
  type WorkDaySchedule,
} from "./work-policy";

export type EvaluatedClockingEvent = {
  type: "start" | "break" | "resume" | "end";
  event_status: "pending" | "accepted" | "rejected" | "cancelled";
  pointed_at: string;
};

export type WorkPolicyMessage = {
  tone: "info" | "reminder" | "attention" | "success";
  title: string;
  message: string;
};

export type WorkPolicyReminder = WorkPolicyMessage & {
  key: string;
};

export type BreakProgress = {
  allowedMinutes: number;
  elapsedMinutes: number;
  remainingMinutes: number;
  overdueMinutes: number;
  progressPercent: number;
};

export type WorkdayEvaluation = {
  schedule: WorkDaySchedule | null;
  expectedMinutes: number;
  workedMinutes: number;
  pauseMinutes: number;
  arrivalLateMinutes: number;
  breakOverrunMinutes: number;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  rawOvertimeMinutes: number;
  overtimeMinutes: number;
  overtimeApprovalStatus: "not_required" | "pending" | "approved" | "rejected";
  differenceMinutes: number;
  automaticClosure: "none" | "scheduled_end" | "break_start";
  automaticClosurePenaltyMinutes: number;
  label: "Conforme" | "À venir" | "Retard" | "Départ anticipé" | "Temps supplémentaire" | "Incomplète" | "Clôture automatique" | "Non planifiée";
};

function timeMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function balanceDifference(
  workedMinutes: number,
  expectedMinutes: number,
  breakOverrunMinutes: number,
  deductBreakOverrun: boolean,
) {
  const rawDifference = workedMinutes - expectedMinutes;
  if (deductBreakOverrun || rawDifference >= 0) return rawDifference;
  return rawDifference + Math.min(breakOverrunMinutes, Math.abs(rawDifference));
}

function zonedParts(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function weekdayForDate(dateKey: string) {
  const day = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function validEvents(events: EvaluatedClockingEvent[], roundingMinutes = 0) {
  const interval = roundingMinutes * 60_000;
  return [...events]
    .filter(
      (event) =>
        event.event_status === "accepted" || event.event_status === "pending",
    )
    .map((event) => interval > 0
      ? { ...event, pointed_at: new Date(Math.round(+new Date(event.pointed_at) / interval) * interval).toISOString() }
      : event)
    .sort((a, b) => +new Date(a.pointed_at) - +new Date(b.pointed_at));
}

function durations(
  events: EvaluatedClockingEvent[],
  now: Date,
  includeOpenSegments = true,
  roundingMinutes = 0,
) {
  const chronological = validEvents(events, roundingMinutes);
  let workStartedAt: number | null = null;
  let pauseStartedAt: number | null = null;
  let worked = 0;
  let paused = 0;

  for (const event of chronological) {
    const timestamp = +new Date(event.pointed_at);
    if (event.type === "start" || event.type === "resume") {
      workStartedAt = timestamp;
      if (pauseStartedAt !== null) {
        paused += Math.max(0, timestamp - pauseStartedAt);
        pauseStartedAt = null;
      }
    }
    if (event.type === "break") {
      if (workStartedAt !== null) {
        worked += Math.max(0, timestamp - workStartedAt);
        workStartedAt = null;
      }
      pauseStartedAt = timestamp;
    }
    if (event.type === "end") {
      if (workStartedAt !== null) {
        worked += Math.max(0, timestamp - workStartedAt);
        workStartedAt = null;
      }
      if (pauseStartedAt !== null) {
        paused += Math.max(0, timestamp - pauseStartedAt);
        pauseStartedAt = null;
      }
    }
  }

  const last = chronological.at(-1);
  if (includeOpenSegments && workStartedAt !== null && last?.type !== "end") {
    worked += Math.max(0, +now - workStartedAt);
  }
  if (includeOpenSegments && pauseStartedAt !== null && last?.type === "break") {
    paused += Math.max(0, +now - pauseStartedAt);
  }

  return {
    events: chronological,
    workedMinutes: Math.floor(worked / 60_000),
    pauseMinutes: Math.floor(paused / 60_000),
  };
}

function repeatedReminderKey(
  prefix: string,
  overdueMinutes: number,
  repeatMinutes: number,
  followUpEnabled: boolean,
) {
  if (!followUpEnabled || overdueMinutes < 5) return `${prefix}-100`;
  return `${prefix}-overdue-${Math.floor((overdueMinutes - 5) / Math.max(1, repeatMinutes))}`;
}

export function currentBreakProgress({
  definition,
  events,
  now,
  timeZone,
}: {
  definition: WorkPolicyDefinition;
  events: EvaluatedClockingEvent[];
  now: Date;
  timeZone: string;
}): BreakProgress | null {
  if (definition.mode !== "fixed") return null;
  const localNow = zonedParts(now, timeZone);
  const schedule = scheduleForDay(
    definition,
    weekdayForDate(localNow.date),
  );
  if (!schedule || schedule.breakMinutes <= 0) return null;

  const last = validEvents(events).at(-1);
  if (!last || last.type !== "break") return null;

  const elapsedMinutes = Math.max(
    0,
    Math.floor((+now - +new Date(last.pointed_at)) / 60_000),
  );
  const remainingMinutes = Math.max(
    0,
    schedule.breakMinutes - elapsedMinutes,
  );
  const overdueMinutes = Math.max(
    0,
    elapsedMinutes - schedule.breakMinutes,
  );

  return {
    allowedMinutes: schedule.breakMinutes,
    elapsedMinutes,
    remainingMinutes,
    overdueMinutes,
    progressPercent: Math.min(
      100,
      Math.round((elapsedMinutes / schedule.breakMinutes) * 100),
    ),
  };
}

export function currentWorkPolicyReminder({
  definition,
  events,
  now,
  timeZone,
}: {
  definition: WorkPolicyDefinition;
  events: EvaluatedClockingEvent[];
  now: Date;
  timeZone: string;
}): WorkPolicyReminder | null {
  if (definition.mode !== "fixed") return null;
  const reminders = workReminderSettings(definition);
  if (!reminders.enabled) return null;

  const localNow = zonedParts(now, timeZone);
  const schedule = scheduleForDay(
    definition,
    weekdayForDate(localNow.date),
  );
  if (!schedule) return null;

  const result = durations(events, now);
  const last = result.events.at(-1);
  const start = timeMinutes(schedule.startTime);
  const rawEnd = timeMinutes(schedule.endTime);
  const end = rawEnd <= start ? rawEnd + 24 * 60 : rawEnd;
  let currentMinutes = localNow.minutes;
  if (rawEnd <= start && currentMinutes <= rawEnd) currentMinutes += 24 * 60;

  if (!last && currentMinutes < end && reminders.arrivalEnabled) {
    const arrivalWindowStart = start - reminders.arrivalLeadMinutes;
    const reminderAt =
      arrivalWindowStart +
      Math.ceil(
        reminders.arrivalLeadMinutes *
          (reminders.warningPercent / 100),
      );
    if (currentMinutes >= reminderAt && currentMinutes < start) {
      return {
        key: `arrival-warning-${reminders.warningPercent}`,
        tone: "reminder",
        title: `Votre service commence bientôt`,
        message: `Pensez à pointer votre arrivée. Il reste ${start - currentMinutes} min avant ${schedule.startTime}.`,
      };
    }
    if (currentMinutes >= start) {
      const elapsed = currentMinutes - start;
      const toleranceRemaining = Math.max(
        0,
        definition.toleranceMinutes - elapsed,
      );
      return {
        key: repeatedReminderKey(
          "arrival",
          elapsed,
          reminders.repeatMinutes,
          reminders.followUpEnabled,
        ),
        tone:
          elapsed > definition.toleranceMinutes ? "attention" : "reminder",
        title:
          elapsed === 0
            ? "C’est l’heure de commencer"
            : `Arrivée non pointée depuis ${elapsed} min`,
        message:
          toleranceRemaining > 0
            ? `Pointez votre arrivée. Il reste ${toleranceRemaining} min de tolérance.`
            : "Pointez dès votre arrivée. Le retard restera simplement visible dans votre journée.",
      };
    }
    return null;
  }

  if (!last || last.type === "end") return null;

  if (
    last.type === "break" &&
    schedule.breakMinutes > 0 &&
    reminders.breakEndEnabled
  ) {
    const progress = currentBreakProgress({
      definition,
      events,
      now,
      timeZone,
    });
    if (!progress) return null;
    const reminderAt = Math.ceil(
      schedule.breakMinutes * (reminders.warningPercent / 100),
    );
    if (progress.elapsedMinutes < reminderAt) return null;
    if (progress.remainingMinutes > 0) {
      return {
        key: `pause-end-warning-${reminders.warningPercent}`,
        tone: "reminder",
        title: "Votre pause se termine bientôt",
        message: `${progress.remainingMinutes} min restantes sur les ${schedule.breakMinutes} min autorisées.`,
      };
    }
    return {
      key: repeatedReminderKey(
        "pause-end",
        progress.overdueMinutes,
        reminders.repeatMinutes,
        reminders.followUpEnabled,
      ),
      tone: progress.overdueMinutes > 0 ? "attention" : "reminder",
      title:
        progress.overdueMinutes > 0
          ? `Pause dépassée de ${progress.overdueMinutes} min`
          : "Votre temps de pause est atteint",
      message: "Pensez à pointer votre reprise lorsque vous recommencez.",
    };
  }

  const hasBreak = result.events.some((event) => event.type === "break");
  const breakDueAt = definition.minimumBreakAfterMinutes;
  if (
    !hasBreak &&
    breakDueAt > 0 &&
    reminders.breakDueEnabled &&
    (last.type === "start" || last.type === "resume")
  ) {
    const reminderAt = Math.ceil(
      breakDueAt * (reminders.warningPercent / 100),
    );
    if (result.workedMinutes < reminderAt) return null;
    if (result.workedMinutes < breakDueAt) {
      return {
        key: `pause-due-warning-${reminders.warningPercent}`,
        tone: "reminder",
        title: "Votre pause approche",
        message: `Encore ${breakDueAt - result.workedMinutes} min avant la pause prévue.`,
      };
    }
    const overdue = result.workedMinutes - breakDueAt;
    return {
      key: repeatedReminderKey(
        "pause-due",
        overdue,
        reminders.repeatMinutes,
        reminders.followUpEnabled,
      ),
      tone: overdue > 0 ? "attention" : "reminder",
      title:
        overdue > 0
          ? `Pause attendue depuis ${overdue} min`
          : "C’est le moment de prendre votre pause",
      message: `Une pause de ${schedule.breakMinutes} min est prévue. Pointez-la lorsque vous vous arrêtez.`,
    };
  }

  return null;
}

export function evaluateWorkday({
  definition,
  events,
  date,
  now,
  timeZone,
  overtimeReviewStatus,
}: {
  definition: WorkPolicyDefinition;
  events: EvaluatedClockingEvent[];
  date: string;
  now: Date;
  timeZone: string;
  overtimeReviewStatus?: "pending" | "approved" | "rejected";
}): WorkdayEvaluation {
  const localNow = zonedParts(now, timeZone);
  const isCurrentDay = date === localNow.date;
  const isPastDay = date < localNow.date;
  const schedule = scheduleForDay(definition, weekdayForDate(date));
  const result = durations(events, now, isCurrentDay, definition.roundingMinutes);
  const last = result.events.at(-1);
  const pastDayOnBreak = Boolean(isPastDay && last?.type === "break");
  const pastDayStillWorking = Boolean(
    isPastDay && (last?.type === "start" || last?.type === "resume"),
  );
  if (!schedule || definition.mode !== "fixed") {
    const expectedMinutes =
      definition.mode === "flexible" && schedule
        ? Math.round(definition.weeklyTargetMinutes / Math.max(1, definition.days.length))
        : 0;
    const rawOvertimeMinutes = definition.mode === "flexible"
      ? Math.max(0, result.workedMinutes - expectedMinutes)
      : 0;
    const breakOverrunMinutes = schedule
      ? Math.max(0, result.pauseMinutes - schedule.breakMinutes)
      : 0;
    const overtimeApprovalStatus = rawOvertimeMinutes === 0
      ? "not_required"
      : overtimeReviewStatus ?? "pending";
    return {
      schedule,
      expectedMinutes,
      workedMinutes: result.workedMinutes,
      pauseMinutes: result.pauseMinutes,
      arrivalLateMinutes: 0,
      breakOverrunMinutes,
      lateMinutes: 0,
      earlyDepartureMinutes: 0,
      rawOvertimeMinutes,
      overtimeMinutes: rawOvertimeMinutes,
      overtimeApprovalStatus,
      differenceMinutes: balanceDifference(
        result.workedMinutes,
        expectedMinutes,
        breakOverrunMinutes,
        definition.breakOverrunDeductionEnabled ?? false,
      ),
      automaticClosure: pastDayOnBreak ? "break_start" : "none",
      automaticClosurePenaltyMinutes: 0,
      label: pastDayOnBreak
        ? "Clôture automatique"
        : pastDayStillWorking
          ? "Incomplète"
          : schedule
            ? "Conforme"
            : "Non planifiée",
    };
  }

  const expectedMinutes = scheduledMinutes(schedule);
  const firstStart = result.events.find((event) => event.type === "start");
  const lastEnd = [...result.events].reverse().find((event) => event.type === "end");
  const scheduledStart = timeMinutes(schedule.startTime);
  const scheduledEnd = timeMinutes(schedule.endTime);
  if (!result.events.length) {
    const localNow = zonedParts(now, timeZone);
    const upcoming =
      date > localNow.date ||
      (date === localNow.date && localNow.minutes < scheduledStart);
    return {
      schedule,
      expectedMinutes,
      workedMinutes: 0,
      pauseMinutes: 0,
      arrivalLateMinutes: 0,
      breakOverrunMinutes: 0,
      lateMinutes: 0,
      earlyDepartureMinutes: 0,
      rawOvertimeMinutes: 0,
      overtimeMinutes: 0,
      overtimeApprovalStatus: "not_required",
      differenceMinutes: -expectedMinutes,
      automaticClosure: "none",
      automaticClosurePenaltyMinutes: 0,
      label: upcoming ? "À venir" : "Incomplète",
    };
  }
  const startMinutes = firstStart
    ? zonedParts(new Date(firstStart.pointed_at), timeZone).minutes
    : null;
  let endMinutes = lastEnd
    ? zonedParts(new Date(lastEnd.pointed_at), timeZone).minutes
    : null;
  let workedMinutes = result.workedMinutes;
  let automaticClosure: WorkdayEvaluation["automaticClosure"] = "none";
  let automaticClosurePenalty = 0;

  if (pastDayOnBreak && last) {
    automaticClosure = "break_start";
    endMinutes = zonedParts(new Date(last.pointed_at), timeZone).minutes;
  } else if (pastDayStillWorking && last) {
    const lastMinutes = zonedParts(new Date(last.pointed_at), timeZone).minutes;
    const scheduledStartForRange = timeMinutes(schedule.startTime);
    let scheduledEndForRange = timeMinutes(schedule.endTime);
    let lastMinutesForRange = lastMinutes;
    if (scheduledEndForRange <= scheduledStartForRange) {
      scheduledEndForRange += 24 * 60;
      if (lastMinutesForRange < scheduledStartForRange) {
        lastMinutesForRange += 24 * 60;
      }
    }
    const inferredOpenMinutes = Math.max(
      0,
      scheduledEndForRange - lastMinutesForRange,
    );
    automaticClosurePenalty = unclosedDayPenaltyMinutes(definition);
    workedMinutes = Math.max(
      0,
      workedMinutes + inferredOpenMinutes - automaticClosurePenalty,
    );
    automaticClosure = "scheduled_end";
    endMinutes = timeMinutes(schedule.endTime);
  }
  const arrivalLateMinutes =
    startMinutes === null
      ? 0
      : Math.max(0, startMinutes - scheduledStart - definition.toleranceMinutes);
  const breakOverrunMinutes = Math.max(
    0,
    result.pauseMinutes - schedule.breakMinutes,
  );
  // "Retard" is strictly the delayed start of service. A long pause is a
  // distinct compliance indicator and must never inflate arrival lateness.
  const lateMinutes = arrivalLateMinutes;
  const earlyDepartureMinutes =
    endMinutes === null ? 0 : Math.max(0, scheduledEnd - endMinutes);
  const rawOvertimeMinutes = Math.max(0, workedMinutes - expectedMinutes);
  const overtimeApprovalStatus = rawOvertimeMinutes === 0
    ? "not_required"
    : overtimeReviewStatus ?? "pending";
  // Approval is an administrative review state, not an accounting gate.
  // Detected overtime must remain visible in totals and balances immediately.
  const overtimeMinutes = rawOvertimeMinutes;
  const differenceMinutes = balanceDifference(
    workedMinutes,
    expectedMinutes,
    breakOverrunMinutes,
    definition.breakOverrunDeductionEnabled ?? false,
  );

  let label: WorkdayEvaluation["label"] = "Conforme";
  if (automaticClosure !== "none") label = "Clôture automatique";
  else if (last && last.type !== "end") label = "Incomplète";
  else if (lateMinutes > 0) label = "Retard";
  else if (earlyDepartureMinutes > 0) label = "Départ anticipé";
  else if (overtimeMinutes > 0) label = "Temps supplémentaire";

  return {
    schedule,
    expectedMinutes,
    workedMinutes,
    pauseMinutes: result.pauseMinutes,
    arrivalLateMinutes,
    breakOverrunMinutes,
    lateMinutes,
    earlyDepartureMinutes,
    rawOvertimeMinutes,
    overtimeMinutes,
    overtimeApprovalStatus,
    differenceMinutes,
    automaticClosure,
    automaticClosurePenaltyMinutes: automaticClosurePenalty,
    label,
  };
}

export function currentWorkPolicyMessage({
  definition,
  events,
  now,
  timeZone,
}: {
  definition: WorkPolicyDefinition;
  events: EvaluatedClockingEvent[];
  now: Date;
  timeZone: string;
}): WorkPolicyMessage | null {
  if (definition.mode !== "fixed") return null;

  const localNow = zonedParts(now, timeZone);
  const schedule = scheduleForDay(
    definition,
    weekdayForDate(localNow.date),
  );
  if (!schedule) {
    return {
      tone: "info",
      title: "Aucun horaire prévu aujourd’hui",
      message: "Vous pouvez tout de même pointer si vous travaillez.",
    };
  }

  const result = durations(events, now);
  const last = result.events.at(-1);
  const start = timeMinutes(schedule.startTime);
  const rawEnd = timeMinutes(schedule.endTime);
  const overnight = rawEnd <= start;
  let currentMinutes = localNow.minutes;
  let end = rawEnd;
  if (overnight && currentMinutes >= start) end += 24 * 60;
  if (overnight && currentMinutes <= rawEnd) {
    currentMinutes += 24 * 60;
    end += 24 * 60;
  }

  if (!last) {
    if (currentMinutes >= end && (!overnight || localNow.minutes <= rawEnd)) {
      return {
        tone: "reminder",
        title: "L’horaire prévu aujourd’hui est terminé",
        message: "Vous pouvez toujours pointer ou signaler un oubli si vous avez travaillé.",
      };
    }
    if (currentMinutes > start + definition.toleranceMinutes && currentMinutes < end) {
      const delay = currentMinutes - start - definition.toleranceMinutes;
      return {
        tone: "attention",
        title: `Vous avez ${delay} min de retard`,
        message: "Vous pouvez pointer normalement. Ce retard sera simplement visible dans votre journée.",
      };
    }
    if (start - currentMinutes <= 60 && start > currentMinutes) {
      return {
        tone: "info",
        title: `Votre service commence à ${schedule.startTime}`,
        message: `Il reste ${start - currentMinutes} minutes avant le début prévu.`,
      };
    }
    return null;
  }

  if (last.type === "end") {
    const evaluation = evaluateWorkday({
      definition,
      events,
      date: localNow.date,
      now,
      timeZone,
    });
    if (evaluation.lateMinutes > 0) {
      return {
        tone: "reminder",
        title: `Journée terminée avec ${evaluation.lateMinutes} min de retard cumulé`,
        message: "Votre pointage est bien enregistré.",
      };
    }
    return {
      tone: "success",
      title: "Votre journée est terminée",
      message: "Tous vos pointages du jour sont enregistrés.",
    };
  }

  if (last.type === "break") {
    const progress = currentBreakProgress({
      definition,
      events,
      now,
      timeZone,
    });
    if (!progress) return null;
    const reminderAt = Math.ceil(schedule.breakMinutes * 0.85);
    if (progress.overdueMinutes > 0) {
      return {
        tone: "attention",
        title: `Pause dépassée de ${progress.overdueMinutes} min`,
        message: `${schedule.breakMinutes} min étaient autorisées. Pensez à pointer votre reprise.`,
      };
    }
    if (progress.remainingMinutes === 0) {
      return {
        tone: "reminder",
        title: "Votre temps de pause est atteint",
        message: `${schedule.breakMinutes} min étaient prévues. Pointez votre reprise lorsque vous recommencez.`,
      };
    }
    return {
      tone:
        progress.elapsedMinutes >= reminderAt ? "reminder" : "info",
      title: `${progress.remainingMinutes} min de pause restantes`,
      message: `${progress.elapsedMinutes} min écoulées sur ${schedule.breakMinutes} min autorisées.`,
    };
  }

  if (currentMinutes >= end) {
    const exceeded = currentMinutes - end;
    return {
      tone: "reminder",
      title: exceeded > 0 ? `Votre service est terminé depuis ${exceeded} min` : "C’est l’heure de la fin de service",
      message: "Terminez votre journée lorsque vous avez fini.",
    };
  }

  const hasBreak = result.events.some((event) => event.type === "break");
  if (
    !hasBreak &&
    definition.minimumBreakAfterMinutes > 0 &&
    result.workedMinutes >=
      Math.ceil(definition.minimumBreakAfterMinutes * 0.85)
  ) {
    const remaining = Math.max(
      0,
      definition.minimumBreakAfterMinutes - result.workedMinutes,
    );
    return {
      tone: remaining > 0 ? "reminder" : "attention",
      title:
        remaining > 0
          ? "Votre pause approche"
          : "Pensez à prendre votre pause",
      message:
        remaining > 0
          ? `Encore ${remaining} min avant la pause prévue.`
          : `Une pause de ${schedule.breakMinutes} min est prévue.`,
    };
  }

  return null;
}
