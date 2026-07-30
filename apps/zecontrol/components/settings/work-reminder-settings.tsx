"use client";

import { BellRing, ChevronDown, Clock3, RotateCcw } from "lucide-react";
import {
  workReminderSettings,
  type WorkPolicyDefinition,
  type WorkReminderSettings as ReminderSettings,
} from "@/lib/work-policy";

const reminderOptions: Array<{
  key: keyof Pick<
    ReminderSettings,
    "arrivalEnabled" | "breakDueEnabled" | "breakEndEnabled" | "followUpEnabled"
  >;
  title: string;
  description: string;
}> = [
  {
    key: "arrivalEnabled",
    title: "Début de journée",
    description: "Avant l’heure prévue, à l’heure puis en cas d’oubli.",
  },
  {
    key: "breakDueEnabled",
    title: "Pause à prendre",
    description: "Lorsque le temps de travail avant pause approche.",
  },
  {
    key: "breakEndEnabled",
    title: "Reprise après pause",
    description: "Avant la fin du temps autorisé, à la fin puis après.",
  },
  {
    key: "followUpEnabled",
    title: "Relancer après l’échéance",
    description: "Répéter le rappel tant que le pointage attendu manque.",
  },
];

export function WorkReminderSettings({
  definition,
  onChange,
  compact = false,
}: {
  definition: WorkPolicyDefinition;
  onChange: (definition: WorkPolicyDefinition) => void;
  compact?: boolean;
}) {
  const settings = workReminderSettings(definition);

  function update(patch: Partial<ReminderSettings>) {
    onChange({
      ...definition,
      reminders: {
        ...settings,
        ...patch,
      },
    });
  }

  return (
    <section className={`work-reminder-settings ${compact ? "is-compact" : ""} ${settings.enabled ? "is-enabled" : ""}`}>
      <header>
        <span><BellRing size={19} /></span>
        <div>
          <strong>Rappels intelligents</strong>
          <small>Aident à pointer au bon moment, sans bloquer les actions.</small>
        </div>
        <button
          className="work-reminder-master-switch"
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          onClick={() => update({ enabled: !settings.enabled })}
        >
          <i />
          {settings.enabled ? "Activés" : "Désactivés"}
        </button>
      </header>

      {settings.enabled && (
        <>
          <div className="work-reminder-options">
            {reminderOptions.map((option) => (
              <label key={option.key}>
                <input
                  type="checkbox"
                  checked={settings[option.key]}
                  onChange={(event) =>
                    update({ [option.key]: event.target.checked })
                  }
                />
                <span>
                  <strong>{option.title}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>

          <details className="work-reminder-advanced">
            <summary>
              <span><Clock3 size={15} /> Régler les seuils</span>
              <small>85 % · toutes les 15 min</small>
              <ChevronDown size={15} />
            </summary>
            <div>
              <label>
                <span>Premier rappel</span>
                <div>
                  <input
                    type="number"
                    min={50}
                    max={95}
                    step={5}
                    value={settings.warningPercent}
                    onChange={(event) =>
                      update({ warningPercent: Number(event.target.value) })
                    }
                  />
                  <em>%</em>
                </div>
              </label>
              <label>
                <span>Fenêtre avant l’arrivée</span>
                <div>
                  <input
                    type="number"
                    min={15}
                    max={180}
                    step={15}
                    value={settings.arrivalLeadMinutes}
                    onChange={(event) =>
                      update({
                        arrivalLeadMinutes: Number(event.target.value),
                      })
                    }
                  />
                  <em>min</em>
                </div>
              </label>
              <label>
                <span>Pause attendue après</span>
                <div>
                  <Clock3 size={14} />
                  <input
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    value={definition.minimumBreakAfterMinutes / 60}
                    disabled={!settings.breakDueEnabled}
                    onChange={(event) =>
                      onChange({
                        ...definition,
                        minimumBreakAfterMinutes: Math.round(
                          Number(event.target.value) * 60,
                        ),
                      })
                    }
                  />
                  <em>h</em>
                </div>
              </label>
              <label>
                <span>Répéter après</span>
                <div>
                  <RotateCcw size={14} />
                  <input
                    type="number"
                    min={5}
                    max={60}
                    step={5}
                    value={settings.repeatMinutes}
                    disabled={!settings.followUpEnabled}
                    onChange={(event) =>
                      update({ repeatMinutes: Number(event.target.value) })
                    }
                  />
                  <em>min</em>
                </div>
              </label>
            </div>
          </details>
          <p className="work-reminder-permission-note">
            Chaque utilisateur garde le choix d’autoriser les notifications sur son appareil.
          </p>
        </>
      )}
    </section>
  );
}
