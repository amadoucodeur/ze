import { dateKey } from "@/lib/reports/period";

export type ClockingEventType = "start" | "break" | "resume" | "end";

export type SequencedClockingEvent = {
  id: string;
  type: ClockingEventType;
  pointed_at: string;
};

export type ClockingDayState = "empty" | "working" | "paused" | "closed";

export type MissingClockingOption =
  | {
      id: string;
      kind: "single";
      type: ClockingEventType;
      title: string;
      hint: string;
    }
  | {
      id: string;
      kind: "complete_break";
      title: string;
      hint: string;
      intervalStart: string;
      intervalEnd: string;
      suggestedStart: string;
      suggestedEnd: string;
    };

const eventTypes: ClockingEventType[] = ["start", "break", "resume", "end"];

function follows(previous: ClockingEventType | null, next: ClockingEventType) {
  if (previous === null) return next === "start";
  if (previous === "start" || previous === "resume") {
    return next === "break" || next === "end";
  }
  if (previous === "break") return next === "resume" || next === "end";
  return false;
}

function isDaySequenceValid(events: SequencedClockingEvent[]) {
  let previous: ClockingEventType | null = null;
  for (const event of events) {
    if (!follows(previous, event.type)) return false;
    previous = event.type;
  }
  return true;
}

export function clockingEventsForDay(
  events: SequencedClockingEvent[],
  day: string,
  timeZone: string,
) {
  return events
    .filter(
      (event) => dateKey(new Date(event.pointed_at), timeZone) === day,
    )
    .sort(
      (left, right) =>
        new Date(left.pointed_at).getTime() -
          new Date(right.pointed_at).getTime() ||
        left.id.localeCompare(right.id),
    );
}

export function clockingDayState(
  events: SequencedClockingEvent[],
): ClockingDayState {
  const last = events.at(-1);
  if (!last) return "empty";
  if (last.type === "end") return "closed";
  if (last.type === "break") return "paused";
  return "working";
}

function completeBreakOptions(events: SequencedClockingEvent[]) {
  const options: MissingClockingOption[] = [];
  let workingSince: SequencedClockingEvent | null = null;

  for (const event of events) {
    if (event.type === "start" || event.type === "resume") {
      workingSince = event;
      continue;
    }
    if (
      workingSince &&
      (event.type === "break" || event.type === "end")
    ) {
      const intervalStart = new Date(workingSince.pointed_at);
      const intervalEnd = new Date(event.pointed_at);
      const duration = intervalEnd.getTime() - intervalStart.getTime();
      if (duration >= 8 * 60_000) {
        const suggestedStart = new Date(
          intervalStart.getTime() + duration / 3,
        );
        const suggestedEnd = new Date(
          intervalStart.getTime() + (duration * 2) / 3,
        );
        options.push({
          id: `complete-break-${workingSince.id}-${event.id}`,
          kind: "complete_break",
          title: "Ajouter une pause complète",
          hint: "Entre deux périodes déjà enregistrées",
          intervalStart: intervalStart.toISOString(),
          intervalEnd: intervalEnd.toISOString(),
          suggestedStart: suggestedStart.toISOString(),
          suggestedEnd: suggestedEnd.toISOString(),
        });
      }
      workingSince = null;
    }
  }

  return options;
}

export function missingClockingOptions(
  dayEvents: SequencedClockingEvent[],
) {
  const state = clockingDayState(dayEvents);
  const options: MissingClockingOption[] = [];

  if (state === "empty") {
    options.push({
      id: "append-start",
      kind: "single",
      type: "start",
      title: "Ajouter l’arrivée",
      hint: "Ouvrir cette journée",
    });
  } else if (state === "working") {
    options.push(
      {
        id: "append-break",
        kind: "single",
        type: "break",
        title: "Ajouter un début de pause",
        hint: "La journée est actuellement ouverte",
      },
      {
        id: "append-end",
        kind: "single",
        type: "end",
        title: "Ajouter le départ",
        hint: "Fermer cette journée",
      },
    );
  } else if (state === "paused") {
    options.push(
      {
        id: "append-resume",
        kind: "single",
        type: "resume",
        title: "Ajouter la reprise",
        hint: "La pause est actuellement ouverte",
      },
      {
        id: "append-end",
        kind: "single",
        type: "end",
        title: "Ajouter le départ",
        hint: "Terminer la journée depuis la pause",
      },
    );
  }

  return [...options, ...completeBreakOptions(dayEvents)];
}

function sequenceWithCandidate(
  events: SequencedClockingEvent[],
  type: ClockingEventType,
  pointedAt: Date,
  timeZone: string,
  excludedEventId?: string,
) {
  const candidateDay = dateKey(pointedAt, timeZone);
  return [
    ...events
      .filter(
        (event) =>
          event.id !== excludedEventId &&
          dateKey(new Date(event.pointed_at), timeZone) === candidateDay,
      )
      .map((event) => ({
        ...event,
        timestamp: new Date(event.pointed_at).getTime(),
        candidate: false,
      })),
    {
      id: "__candidate__",
      type,
      pointed_at: pointedAt.toISOString(),
      timestamp: pointedAt.getTime(),
      candidate: true,
    },
  ]
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp ||
        Number(left.candidate) - Number(right.candidate) ||
        left.id.localeCompare(right.id),
    )
    .map(({ id, type: itemType, pointed_at }) => ({
      id,
      type: itemType,
      pointed_at,
    }));
}

export function validMissingEventTypes(
  events: SequencedClockingEvent[],
  pointedAt: Date,
  timeZone: string,
) {
  if (Number.isNaN(pointedAt.getTime())) return [];
  return eventTypes.filter((type) =>
    isDaySequenceValid(
      sequenceWithCandidate(events, type, pointedAt, timeZone),
    ),
  );
}

export function isCompleteBreakInsertionValid(
  events: SequencedClockingEvent[],
  breakAt: Date,
  resumeAt: Date,
  timeZone: string,
) {
  if (
    Number.isNaN(breakAt.getTime()) ||
    Number.isNaN(resumeAt.getTime()) ||
    breakAt >= resumeAt ||
    dateKey(breakAt, timeZone) !== dateKey(resumeAt, timeZone)
  ) {
    return false;
  }

  const day = dateKey(breakAt, timeZone);
  const sequence = [
    ...clockingEventsForDay(events, day, timeZone),
    {
      id: "__candidate_break__",
      type: "break" as const,
      pointed_at: breakAt.toISOString(),
    },
    {
      id: "__candidate_resume__",
      type: "resume" as const,
      pointed_at: resumeAt.toISOString(),
    },
  ].sort(
    (left, right) =>
      new Date(left.pointed_at).getTime() -
        new Date(right.pointed_at).getTime() ||
      left.id.localeCompare(right.id),
  );

  return isDaySequenceValid(sequence);
}

export function isClockingCorrectionValid(
  events: SequencedClockingEvent[],
  eventId: string,
  pointedAt: Date,
  timeZone: string,
) {
  if (Number.isNaN(pointedAt.getTime())) return false;
  const source = events.find((event) => event.id === eventId);
  if (!source) return false;

  const candidateDay = dateKey(pointedAt, timeZone);
  const sourceDay = dateKey(new Date(source.pointed_at), timeZone);
  const targetIsValid = isDaySequenceValid(
    sequenceWithCandidate(
      events,
      source.type,
      pointedAt,
      timeZone,
      eventId,
    ),
  );
  if (!targetIsValid || sourceDay === candidateDay) return targetIsValid;

  const remainingSourceDay = events
    .filter(
      (event) =>
        event.id !== eventId &&
        dateKey(new Date(event.pointed_at), timeZone) === sourceDay,
    )
    .sort(
      (left, right) =>
        new Date(left.pointed_at).getTime() -
          new Date(right.pointed_at).getTime() ||
        left.id.localeCompare(right.id),
    );
  return isDaySequenceValid(remainingSourceDay);
}
