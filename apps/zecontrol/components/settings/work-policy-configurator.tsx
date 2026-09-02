"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarCheck2,
  Check,
  ChevronDown,
  Clock3,
  Gauge,
  LoaderCircle,
  Save,
  ShieldCheck,
  Sparkles,
  TimerReset,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  areWorkReminderSettingsValid,
  defaultWorkPolicies,
  fixedDailyMinutes,
  formatMinutes,
  isWorkPolicyDefinition,
  policySummary,
  scheduleForDay,
  scheduledMinutes,
  unclosedDayPenaltyMinutes,
  weekdayOptions,
  workReminderSettings,
  type WorkPolicyDefinition,
  type WorkPolicyMode,
} from "@/lib/work-policy";
import { DailyScheduleOverrides } from "./daily-schedule-overrides";
import { WorkReminderSettings } from "./work-reminder-settings";

type Feedback = { type: "error" | "success"; message: string } | null;

type PolicyRow = {
  id: string;
  name: string;
  is_enabled: boolean;
};

const modeOptions: {
  value: WorkPolicyMode;
  title: string;
  description: string;
  badge: string;
}[] = [
  {
    value: "fixed",
    title: "Horaires fixes",
    description: "Des heures de début et de fin clairement définies.",
    badge: "Le plus courant",
  },
  {
    value: "flexible",
    title: "Horaires flexibles",
    description: "Une durée hebdomadaire, sans heure d’arrivée imposée.",
    badge: "Souple",
  },
  {
    value: "attendance",
    title: "Présence uniquement",
    description: "On mesure le temps, sans comparer à un horaire attendu.",
    badge: "Minimal",
  },
];

function organisationDate(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function modeLabel(mode: WorkPolicyMode) {
  return {
    fixed: "Horaires fixes",
    flexible: "Horaires flexibles",
    attendance: "Présence uniquement",
  }[mode];
}

export function WorkPolicyConfigurator({
  organisationId,
  profileId,
  timeZone,
}: {
  organisationId: string;
  profileId: string;
  timeZone: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const today = useMemo(() => organisationDate(timeZone), [timeZone]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policy, setPolicy] = useState<PolicyRow | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [definition, setDefinition] = useState<WorkPolicyDefinition>(
    defaultWorkPolicies.fixed,
  );
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [publishedFrom, setPublishedFrom] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadPolicy() {
      const policyResult = await supabase
        .schema("zecontrol")
        .from("work_policies")
        .select("id, name, is_enabled")
        .eq("organisation_id", organisationId)
        .eq("is_default", true)
        .maybeSingle();

      if (!active) return;
      if (policyResult.error) {
        setLoadError(
          /work_policies|schema cache|does not exist/i.test(policyResult.error.message)
            ? "Le configurateur sera disponible après l’application de la migration des règles de travail."
            : "Les règles de travail ne sont pas accessibles pour le moment.",
        );
        setLoading(false);
        return;
      }

      const currentPolicy = policyResult.data as PolicyRow | null;
      if (!currentPolicy) {
        setLoading(false);
        return;
      }

      const [draftResult, versionResult] = await Promise.all([
        supabase
          .schema("zecontrol")
          .from("work_policy_drafts")
          .select("definition, effective_from")
          .eq("policy_id", currentPolicy.id)
          .maybeSingle(),
        supabase
          .schema("zecontrol")
          .from("work_policy_versions")
          .select("version_number, definition, effective_from")
          .eq("policy_id", currentPolicy.id)
          .order("effective_from", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (!active) return;
      if (draftResult.error || versionResult.error) {
        setLoadError("La configuration enregistrée n’a pas pu être chargée.");
        setLoading(false);
        return;
      }

      const draft = draftResult.data as {
        definition: unknown;
        effective_from: string;
      } | null;
      const version = versionResult.data as {
        version_number: number;
        definition: unknown;
        effective_from: string;
      } | null;
      const sourceDefinition = draft?.definition ?? version?.definition;

      setPolicy(currentPolicy);
      setEnabled(currentPolicy.is_enabled);
      if (isWorkPolicyDefinition(sourceDefinition)) {
        setDefinition(sourceDefinition);
      }
      setEffectiveFrom(
        draft?.effective_from && draft.effective_from >= today
          ? draft.effective_from
          : today,
      );
      setPublishedVersion(version?.version_number ?? null);
      setPublishedFrom(version?.effective_from ?? null);
      setLoading(false);
    }

    void loadPolicy();
    return () => {
      active = false;
    };
  }, [organisationId, supabase, today]);

  const summary = useMemo(() => policySummary(definition), [definition]);
  const weeklyMinutes = useMemo(
    () =>
      definition.mode === "fixed"
        ? definition.days.reduce((total, day) => {
            const schedule = scheduleForDay(definition, day);
            return total + (schedule ? scheduledMinutes(schedule) : 0);
          }, 0)
        : definition.weeklyTargetMinutes,
    [definition],
  );

  function chooseMode(mode: WorkPolicyMode) {
    const source = defaultWorkPolicies[mode];
    setDefinition({
      ...source,
      days: [...source.days],
      daySchedules: {},
      reminders: { ...workReminderSettings(source) },
    });
    setFeedback(null);
  }

  function toggleDay(day: number) {
    setDefinition((current) => ({
      ...current,
      days: current.days.includes(day)
        ? current.days.filter((candidate) => candidate !== day)
        : [...current.days, day].sort((a, b) => a - b),
    }));
  }

  function validate() {
    if (!effectiveFrom || effectiveFrom < today) {
      return "Choisissez aujourd’hui ou une date future.";
    }
    if (definition.mode !== "attendance" && definition.days.length === 0) {
      return "Choisissez au moins un jour travaillé.";
    }
    if (
      definition.mode === "fixed" &&
      definition.startTime >= definition.endTime
    ) {
      return "L’heure de fin doit être après l’heure de début. Les services de nuit seront configurés séparément.";
    }
    if (
      definition.mode === "fixed" &&
      fixedDailyMinutes(definition) <= 0
    ) {
      return "La pause ne peut pas couvrir toute la journée de travail.";
    }
    if (
      definition.mode === "fixed" &&
      definition.days.some((day) => {
        const schedule = scheduleForDay(definition, day);
        return (
          !schedule ||
          schedule.startTime >= schedule.endTime ||
          schedule.breakMinutes < 0 ||
          schedule.breakMinutes > 720 ||
          scheduledMinutes(schedule) <= 0
        );
      })
    ) {
      return "Vérifiez les horaires personnalisés de chaque journée.";
    }
    if (
      definition.mode === "flexible" &&
      (definition.weeklyTargetMinutes < 60 ||
        definition.weeklyTargetMinutes > 7 * 24 * 60)
    ) {
      return "La durée hebdomadaire attendue n’est pas valide.";
    }
    if (
      !Number.isFinite(definition.breakMinutes) ||
      definition.breakMinutes < 0 ||
      definition.breakMinutes > 720 ||
      !Number.isFinite(definition.toleranceMinutes) ||
      definition.toleranceMinutes < 0 ||
      definition.toleranceMinutes > 180 ||
      !Number.isFinite(definition.minimumRestMinutes) ||
      definition.minimumRestMinutes < 0 ||
      definition.minimumRestMinutes > 2880 ||
      !Number.isFinite(definition.minimumBreakAfterMinutes) ||
      definition.minimumBreakAfterMinutes < 0 ||
      definition.minimumBreakAfterMinutes > 1440 ||
      !Number.isFinite(unclosedDayPenaltyMinutes(definition)) ||
      unclosedDayPenaltyMinutes(definition) < 0 ||
      unclosedDayPenaltyMinutes(definition) > 720
    ) {
      return "Une durée configurée n’est pas valide.";
    }
    if (
      definition.mode === "fixed" &&
      workReminderSettings(definition).enabled &&
      !areWorkReminderSettingsValid(definition)
    ) {
      return "Vérifiez les seuils configurés pour les rappels.";
    }
    return null;
  }

  async function savePolicy() {
    setFeedback(null);

    if (!enabled && !policy) {
      setFeedback({
        type: "success",
        message: "Le cadre de travail reste désactivé. Aucun réglage n’est imposé.",
      });
      return;
    }

    const validationError = enabled ? validate() : null;
    if (validationError) {
      setFeedback({ type: "error", message: validationError });
      return;
    }

    setSaving(true);
    try {
      let targetPolicy = policy;

      if (!targetPolicy) {
        const { data, error } = await supabase
          .schema("zecontrol")
          .from("work_policies")
          .insert({
            organisation_id: organisationId,
            name: "Cadre de travail principal",
            is_enabled: false,
            is_default: true,
            created_by: profileId,
          })
          .select("id, name, is_enabled")
          .single();

        if (error || !data) throw error ?? new Error("policy_creation_failed");
        targetPolicy = data as PolicyRow;
        setPolicy(targetPolicy);
      }

      if (!enabled) {
        const { error } = await supabase
          .schema("zecontrol")
          .from("work_policies")
          .update({ is_enabled: false, updated_at: new Date().toISOString() })
          .eq("id", targetPolicy.id);
        if (error) throw error;

        setPolicy({ ...targetPolicy, is_enabled: false });
        setFeedback({
          type: "success",
          message: "Le cadre de travail est désactivé. Les pointages restent disponibles.",
        });
        return;
      }

      const { error: draftError } = await supabase
        .schema("zecontrol")
        .from("work_policy_drafts")
        .upsert(
          {
            policy_id: targetPolicy.id,
            definition,
            effective_from: effectiveFrom,
            updated_by: profileId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "policy_id" },
        );
      if (draftError) throw draftError;

      const { data: publication, error: publicationError } = await supabase
        .schema("zecontrol")
        .rpc("publish_work_policy", {
          target_policy_id: targetPolicy.id,
          target_effective_from: effectiveFrom,
        });
      if (publicationError) throw publicationError;

      const result = publication as {
        version?: number;
        effectiveFrom?: string;
      } | null;
      setPolicy({ ...targetPolicy, is_enabled: true });
      setPublishedVersion(result?.version ?? (publishedVersion ?? 0) + 1);
      setPublishedFrom(result?.effectiveFrom ?? effectiveFrom);
      setFeedback({
        type: "success",
        message:
          effectiveFrom === today
            ? "Le cadre de travail est actif dès aujourd’hui."
            : `Le cadre de travail sera actif le ${new Intl.DateTimeFormat("fr-FR").format(new Date(`${effectiveFrom}T12:00:00`))}.`,
      });
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String(error.message)
          : error instanceof Error
            ? error.message
            : "";
      const accessError = /access_denied|authentication|jwt/i.test(message);
      const retroactiveError = /retroactive/i.test(message);
      setFeedback({
        type: "error",
        message: accessError
          ? "Votre session ou votre accès ne permet plus cette modification."
          : retroactiveError
            ? "Choisissez aujourd’hui ou une date future."
            : "Le cadre de travail n’a pas pu être enregistré. Réessayez.",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="settings-loading">
        <LoaderCircle className="spin" size={22} /> Chargement du cadre de travail...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="settings-error-state" role="alert">
        <ShieldCheck size={24} />
        <strong>Configurateur indisponible</strong>
        <p>{loadError}</p>
      </div>
    );
  }

  return (
    <div className="work-policy-configurator">
      <section className={`work-policy-toggle-card ${enabled ? "is-on" : ""}`}>
        <span className="work-policy-toggle-icon">
          <ShieldCheck size={24} />
        </span>
        <div>
          <small>Optionnel</small>
          <h2>Cadre de travail</h2>
          <p>
            {enabled
              ? "ZeControl compare les journées aux règles que vous publiez."
              : "Les pointages fonctionnent sans horaire imposé tant que ce cadre reste désactivé."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className="work-policy-switch"
          onClick={() => {
            setEnabled((current) => !current);
            setFeedback(null);
          }}
        >
          <span />
          {enabled ? "Activé" : "Désactivé"}
        </button>
      </section>

      {!enabled ? (
        <section className="work-policy-off-state">
          <span><Clock3 size={26} /></span>
          <div>
            <h2>Aucune contrainte pour le moment</h2>
            <p>
              Vos collaborateurs peuvent continuer à pointer normalement. Activez
              le cadre uniquement lorsque vous souhaitez définir des horaires,
              pauses ou tolérances.
            </p>
          </div>
        </section>
      ) : (
        <div className="work-policy-layout">
          <div className="work-policy-editor">
            <section className="work-policy-step">
              <header>
                <span>1</span>
                <div>
                  <h2>Comment votre équipe travaille-t-elle ?</h2>
                  <p>Choisissez simplement le modèle le plus proche.</p>
                </div>
              </header>
              <div className="work-policy-mode-grid">
                {modeOptions.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={definition.mode === option.value ? "is-selected" : ""}
                    onClick={() => chooseMode(option.value)}
                    aria-pressed={definition.mode === option.value}
                  >
                    <span>{option.badge}</span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                    <i>{definition.mode === option.value && <Check size={14} />}</i>
                  </button>
                ))}
              </div>
            </section>

            {definition.mode !== "attendance" && (
              <section className="work-policy-step">
                <header>
                  <span>2</span>
                  <div>
                    <h2>Quels jours sont travaillés ?</h2>
                    <p>Un clic suffit pour ajouter ou retirer un jour.</p>
                  </div>
                </header>
                <div className="work-policy-days" aria-label="Jours travaillés">
                  {weekdayOptions.map((day) => (
                    <button
                      type="button"
                      key={day.value}
                      className={definition.days.includes(day.value) ? "is-selected" : ""}
                      onClick={() => toggleDay(day.value)}
                      aria-pressed={definition.days.includes(day.value)}
                      title={day.label}
                    >
                      <span>{day.short}</span>
                      <small>{day.label.slice(0, 3)}</small>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {definition.mode !== "attendance" && (
              <section className="work-policy-step">
                <header>
                  <span>3</span>
                  <div>
                    <h2>Les repères essentiels</h2>
                    <p>Ce sont les seuls réglages nécessaires pour commencer.</p>
                  </div>
                </header>
                <div className="work-policy-fields">
                  {definition.mode === "fixed" ? (
                    <>
                      <label>
                        <span>Début</span>
                        <div><Clock3 size={17} /><input type="time" value={definition.startTime} onChange={(event) => setDefinition({ ...definition, startTime: event.target.value })} /></div>
                      </label>
                      <label>
                        <span>Fin</span>
                        <div><Clock3 size={17} /><input type="time" value={definition.endTime} onChange={(event) => setDefinition({ ...definition, endTime: event.target.value })} /></div>
                      </label>
                    </>
                  ) : (
                    <label className="wide">
                      <span>Temps attendu par semaine</span>
                      <div><Gauge size={17} /><input type="number" min={1} max={168} step={0.5} value={definition.weeklyTargetMinutes / 60} onChange={(event) => setDefinition({ ...definition, weeklyTargetMinutes: Math.round(Number(event.target.value) * 60) })} /><em>heures</em></div>
                    </label>
                  )}
                  <label>
                    <span>Pause prévue</span>
                    <div><TimerReset size={17} /><input type="number" min={0} max={720} step={5} value={definition.breakMinutes} onChange={(event) => setDefinition({ ...definition, breakMinutes: Number(event.target.value) })} /><em>min</em></div>
                  </label>
                  {definition.mode === "fixed" && (
                    <label>
                      <span>Tolérance d’arrivée</span>
                      <div><Gauge size={17} /><input type="number" min={0} max={180} step={5} value={definition.toleranceMinutes} onChange={(event) => setDefinition({ ...definition, toleranceMinutes: Number(event.target.value) })} /><em>min</em></div>
                    </label>
                  )}
                </div>
                {definition.mode === "fixed" && (
                  <DailyScheduleOverrides
                    definition={definition}
                    onChange={setDefinition}
                  />
                )}
              </section>
            )}

            {definition.mode === "fixed" && (
              <section className="work-policy-step work-policy-reminder-step">
                <header>
                  <span>4</span>
                  <div>
                    <h2>Les rappels utiles</h2>
                    <p>Activez seulement les rappels dont votre équipe a besoin.</p>
                  </div>
                </header>
                <WorkReminderSettings
                  definition={definition}
                  onChange={setDefinition}
                />
              </section>
            )}

            <details className="work-policy-advanced">
              <summary>
                <span><Sparkles size={17} /> Options avancées</span>
                <small>Repos et arrondis</small>
                <ChevronDown size={17} />
              </summary>
              <div className="work-policy-advanced-content">
                {definition.mode !== "attendance" && (
                  <label className="work-policy-check">
                    <input
                      type="checkbox"
                      checked={definition.breakOverrunDeductionEnabled ?? false}
                      onChange={(event) => setDefinition({
                        ...definition,
                        breakOverrunDeductionEnabled: event.target.checked,
                      })}
                    />
                    <span>
                      <strong>Déduire les dépassements de pause des soldes</strong>
                      <small>Désactivé par défaut : le dépassement reste visible, sans réduire les soldes.</small>
                    </span>
                  </label>
                )}
                <div className="work-policy-fields">
                  <label>
                    <span>Repos minimal entre deux journées</span>
                    <div><TimerReset size={17} /><input type="number" min={0} max={48} step={1} value={definition.minimumRestMinutes / 60} onChange={(event) => setDefinition({ ...definition, minimumRestMinutes: Math.round(Number(event.target.value) * 60) })} /><em>h</em></div>
                  </label>
                  <label className="wide">
                    <span>Arrondir les pointages</span>
                    <div>
                      <Gauge size={17} />
                      <select value={definition.roundingMinutes} onChange={(event) => setDefinition({ ...definition, roundingMinutes: Number(event.target.value) as 0 | 5 | 10 | 15 })}>
                        <option value={0}>Aucun arrondi</option>
                        <option value={5}>À 5 minutes</option>
                        <option value={10}>À 10 minutes</option>
                        <option value={15}>À 15 minutes</option>
                      </select>
                    </div>
                  </label>
                  {definition.mode === "fixed" && (
                    <label className="wide">
                      <span>Pénalité si le départ est oublié</span>
                      <div>
                        <TimerReset size={17} />
                        <input
                          type="number"
                          min={0}
                          max={720}
                          step={5}
                          value={unclosedDayPenaltyMinutes(definition)}
                          onChange={(event) =>
                            setDefinition({
                              ...definition,
                              unclosedDayPenaltyMinutes: Number(event.target.value),
                            })
                          }
                        />
                        <em>min</em>
                      </div>
                    </label>
                  )}
                </div>
              </div>
            </details>
          </div>

          <aside className="work-policy-preview">
            <span className="work-policy-preview-label"><Sparkles size={14} /> Résumé automatique</span>
            <h2>{modeLabel(definition.mode)}</h2>
            <p>{summary}</p>
            {definition.mode !== "attendance" && (
              <div className="work-policy-preview-metric">
                <small>Temps hebdomadaire attendu</small>
                <strong>{formatMinutes(weeklyMinutes)}</strong>
              </div>
            )}
            <ul>
              <li><Check size={14} /> {definition.breakMinutes > 0 ? `${definition.breakMinutes} min de pause prévues` : "Aucune pause déduite"}</li>
              {definition.mode === "fixed" && (
                <li>
                  <Check size={14} />{" "}
                  {workReminderSettings(definition).enabled
                    ? `Rappels à ${workReminderSettings(definition).warningPercent} %`
                    : "Rappels automatiques désactivés"}
                </li>
              )}
              <li><Check size={14} /> {definition.overtimeEnabled ? "Temps supplémentaire suivi" : "Pas de suivi des dépassements"}</li>
              {definition.mode === "fixed" && (
                <li>
                  <Check size={14} /> Départ oublié : {unclosedDayPenaltyMinutes(definition)} min retirées
                </li>
              )}
              <li><Check size={14} /> Chaque journée garde la règle qui lui était applicable</li>
            </ul>
            <label className="work-policy-effective">
              <span><CalendarCheck2 size={16} /> Appliquer à partir du</span>
              <input type="date" min={today} value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
            </label>
            {publishedVersion && (
              <small className="work-policy-version">
                Version {publishedVersion}
                {publishedFrom ? ` · publiée pour le ${new Intl.DateTimeFormat("fr-FR").format(new Date(`${publishedFrom}T12:00:00`))}` : ""}
              </small>
            )}
          </aside>
        </div>
      )}

      {feedback && (
        <div className={`form-message form-${feedback.type}`} role={feedback.type === "error" ? "alert" : "status"}>
          {feedback.type === "success" && <Check size={16} />} {feedback.message}
        </div>
      )}

      <div className="work-policy-actions">
        <div>
          <strong>{enabled ? "Prêt à publier" : "Cadre désactivé"}</strong>
          <span>
            {enabled
              ? "Les nouvelles règles ne modifieront jamais les anciennes journées."
              : "Les pointages et rapports continuent de fonctionner normalement."}
          </span>
        </div>
        <button className="button button-primary" type="button" onClick={() => void savePolicy()} disabled={saving}>
          {saving ? <><LoaderCircle className="spin" size={17} /> Enregistrement...</> : <><Save size={17} /> {enabled ? "Publier ce cadre" : "Confirmer"}</>}
        </button>
      </div>
    </div>
  );
}
