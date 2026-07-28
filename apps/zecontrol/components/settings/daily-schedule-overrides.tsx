"use client";

import { CalendarRange, Clock3, TimerReset } from "lucide-react";
import {
  scheduleForDay,
  weekdayOptions,
  type WorkPolicyDefinition,
} from "@/lib/work-policy";

export function DailyScheduleOverrides({
  definition,
  onChange,
}: {
  definition: WorkPolicyDefinition;
  onChange: (definition: WorkPolicyDefinition) => void;
}) {
  const customized = Object.keys(definition.daySchedules ?? {}).length > 0;

  function toggleCustomization() {
    if (customized) {
      onChange({ ...definition, daySchedules: {} });
      return;
    }

    onChange({
      ...definition,
      daySchedules: Object.fromEntries(
        definition.days.map((day) => [
          String(day),
          {
            startTime: definition.startTime,
            endTime: definition.endTime,
            breakMinutes: definition.breakMinutes,
          },
        ]),
      ),
    });
  }

  function updateDay(
    day: number,
    field: "startTime" | "endTime" | "breakMinutes",
    value: string | number,
  ) {
    const current = scheduleForDay(definition, day) ?? {
      startTime: definition.startTime,
      endTime: definition.endTime,
      breakMinutes: definition.breakMinutes,
    };
    onChange({
      ...definition,
      daySchedules: {
        ...(definition.daySchedules ?? {}),
        [String(day)]: { ...current, [field]: value },
      },
    });
  }

  return (
    <div className={`daily-schedule-overrides ${customized ? "is-open" : ""}`}>
      <button type="button" onClick={toggleCustomization} aria-expanded={customized}>
        <span><CalendarRange size={17} /></span>
        <div>
          <strong>Des horaires différents selon le jour ?</strong>
          <small>
            {customized
              ? "Chaque journée possède maintenant ses propres heures."
              : "Les mêmes heures s’appliquent actuellement à tous les jours."}
          </small>
        </div>
        <em>{customized ? "Oui" : "Modifier"}</em>
      </button>

      {customized && (
        <div className="daily-schedule-list">
          {weekdayOptions
            .filter((day) => definition.days.includes(day.value))
            .map((day) => {
              const schedule = scheduleForDay(definition, day.value)!;
              return (
                <article key={day.value}>
                  <strong>{day.label}</strong>
                  <label>
                    <span><Clock3 size={14} /> Début</span>
                    <input
                      type="time"
                      value={schedule.startTime}
                      onChange={(event) => updateDay(day.value, "startTime", event.target.value)}
                    />
                  </label>
                  <label>
                    <span><Clock3 size={14} /> Fin</span>
                    <input
                      type="time"
                      value={schedule.endTime}
                      onChange={(event) => updateDay(day.value, "endTime", event.target.value)}
                    />
                  </label>
                  <label>
                    <span><TimerReset size={14} /> Pause</span>
                    <div>
                      <input
                        type="number"
                        min={0}
                        max={720}
                        step={5}
                        value={schedule.breakMinutes}
                        onChange={(event) => updateDay(day.value, "breakMinutes", Number(event.target.value))}
                      />
                      <em>min</em>
                    </div>
                  </label>
                </article>
              );
            })}
        </div>
      )}
    </div>
  );
}
