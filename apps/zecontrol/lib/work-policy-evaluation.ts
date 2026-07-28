import {
  scheduleForDay,
  scheduledMinutes,
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

export type WorkdayEvaluation = {
  schedule: WorkDaySchedule | null;
  expectedMinutes: number;
  workedMinutes: number;
  pauseMinutes: number;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  overtimeMinutes: number;
  differenceMinutes: number;
  label: "Conforme" | "À venir" | "Retard" | "Départ anticipé" | "Heures supplémentaires" | "Incomplète" | "Non planifiée";
};

function timeMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
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

function validEvents(events: EvaluatedClockingEvent[]) {
  return [...events]
    .filter(
      (event) =>
        event.event_status === "accepted" || event.event_status === "pending",
    )
    .sort((a, b) => +new Date(a.pointed_at) - +new Date(b.pointed_at));
}

function durations(events: EvaluatedClockingEvent[], now: Date) {
  const chronological = validEvents(events);
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
  if (workStartedAt !== null && last?.type !== "end") {
    worked += Math.max(0, +now - workStartedAt);
  }
  if (pauseStartedAt !== null && last?.type === "break") {
    paused += Math.max(0, +now - pauseStartedAt);
  }

  return {
    events: chronological,
    workedMinutes: Math.floor(worked / 60_000),
    pauseMinutes: Math.floor(paused / 60_000),
  };
}

export function evaluateWorkday({
  definition,
  events,
  date,
  now,
  timeZone,
}: {
  definition: WorkPolicyDefinition;
  events: EvaluatedClockingEvent[];
  date: string;
  now: Date;
  timeZone: string;
}): WorkdayEvaluation {
  const schedule = scheduleForDay(definition, weekdayForDate(date));
  const result = durations(events, now);
  if (!schedule || definition.mode !== "fixed") {
    return {
      schedule,
      expectedMinutes:
        definition.mode === "flexible"
          ? Math.round(definition.weeklyTargetMinutes / Math.max(1, definition.days.length))
          : 0,
      workedMinutes: result.workedMinutes,
      pauseMinutes: result.pauseMinutes,
      lateMinutes: 0,
      earlyDepartureMinutes: 0,
      overtimeMinutes: 0,
      differenceMinutes: result.workedMinutes,
      label: schedule ? "Conforme" : "Non planifiée",
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
      lateMinutes: 0,
      earlyDepartureMinutes: 0,
      overtimeMinutes: 0,
      differenceMinutes: -expectedMinutes,
      label: upcoming ? "À venir" : "Incomplète",
    };
  }
  const startMinutes = firstStart
    ? zonedParts(new Date(firstStart.pointed_at), timeZone).minutes
    : null;
  const endMinutes = lastEnd
    ? zonedParts(new Date(lastEnd.pointed_at), timeZone).minutes
    : null;
  const lateMinutes =
    startMinutes === null
      ? 0
      : Math.max(0, startMinutes - scheduledStart - definition.toleranceMinutes);
  const earlyDepartureMinutes =
    endMinutes === null ? 0 : Math.max(0, scheduledEnd - endMinutes);
  const overtimeMinutes = definition.overtimeEnabled
    ? Math.max(0, result.workedMinutes - expectedMinutes)
    : 0;
  const differenceMinutes = result.workedMinutes - expectedMinutes;
  const last = result.events.at(-1);

  let label: WorkdayEvaluation["label"] = "Conforme";
  if (last && last.type !== "end") label = "Incomplète";
  else if (lateMinutes > 0) label = "Retard";
  else if (earlyDepartureMinutes > 0) label = "Départ anticipé";
  else if (overtimeMinutes > 0) label = "Heures supplémentaires";

  return {
    schedule,
    expectedMinutes,
    workedMinutes: result.workedMinutes,
    pauseMinutes: result.pauseMinutes,
    lateMinutes,
    earlyDepartureMinutes,
    overtimeMinutes,
    differenceMinutes,
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
        title: `Journée terminée avec ${evaluation.lateMinutes} min de retard`,
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
    const breakStartedAt = +new Date(last.pointed_at);
    const currentBreakMinutes = Math.floor((+now - breakStartedAt) / 60_000);
    if (schedule.breakMinutes > 0 && currentBreakMinutes >= schedule.breakMinutes) {
      return {
        tone: "info",
        title: "Votre pause prévue est atteinte",
        message: `Vous êtes en pause depuis ${currentBreakMinutes} minutes. Reprenez lorsque vous êtes prêt.`,
      };
    }
    return null;
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
    result.workedMinutes >= definition.minimumBreakAfterMinutes
  ) {
    return {
      tone: "reminder",
      title: "Pensez à prendre une pause",
      message: `Vous travaillez depuis ${Math.floor(result.workedMinutes / 60)} h sans interruption.`,
    };
  }

  return null;
}
