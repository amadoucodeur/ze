"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarOff,
  Check,
  LoaderCircle,
  Plus,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type TargetType = "organisation" | "service" | "profile";

type ProfileOption = {
  id: string;
  fullname: string;
  service: string | null;
};

type CalendarException = {
  id: string;
  work_date: string;
  target_type: TargetType;
  service_name: string | null;
  profile_id: string | null;
  label: string;
};

function todayIn(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function NonWorkingDays({
  organisationId,
  profileId,
  timeZone,
}: {
  organisationId: string;
  profileId: string;
  timeZone: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const today = useMemo(() => todayIn(timeZone), [timeZone]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [exceptions, setExceptions] = useState<CalendarException[]>([]);
  const [workDate, setWorkDate] = useState(today);
  const [targetType, setTargetType] = useState<TargetType>("organisation");
  const [targetValue, setTargetValue] = useState("");
  const [label, setLabel] = useState("Journée non travaillée");
  const [feedback, setFeedback] = useState<{
    type: "error" | "success";
    message: string;
  } | null>(null);

  const services = useMemo(
    () => Array.from(new Set(profiles.map((profile) => profile.service).filter((value): value is string => Boolean(value?.trim())))).sort((a, b) => a.localeCompare(b, "fr")),
    [profiles],
  );
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );

  async function reload() {
    const [profilesResult, exceptionsResult] = await Promise.all([
      supabase.schema("zecontrol").rpc("list_report_profiles", {
        target_organisation_id: organisationId,
      }),
      supabase
        .schema("zecontrol")
        .from("work_calendar_exceptions")
        .select("id, work_date, target_type, service_name, profile_id, label")
        .eq("organisation_id", organisationId)
        .order("work_date", { ascending: true }),
    ]);

    if (profilesResult.error || exceptionsResult.error) {
      setFeedback({ type: "error", message: "Les journées non travaillées ne sont pas accessibles." });
      setLoading(false);
      return;
    }
    setProfiles((profilesResult.data ?? []) as ProfileOption[]);
    setExceptions((exceptionsResult.data ?? []) as CalendarException[]);
    setLoading(false);
  }

  useEffect(() => {
    // State is populated after the asynchronous Supabase requests complete.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisationId, supabase]);

  function chooseTarget(next: TargetType) {
    setTargetType(next);
    setTargetValue(
      next === "service"
        ? services[0] ?? ""
        : next === "profile"
          ? profiles[0]?.id ?? ""
          : "",
    );
  }

  async function addException() {
    const cleanLabel = label.trim();
    if (!workDate) {
      setFeedback({ type: "error", message: "Choisissez la date concernée." });
      return;
    }
    if (cleanLabel.length < 2) {
      setFeedback({ type: "error", message: "Donnez un libellé à cette journée." });
      return;
    }
    if (targetType !== "organisation" && !targetValue) {
      setFeedback({ type: "error", message: "Choisissez le service ou le collaborateur concerné." });
      return;
    }

    setSaving(true);
    setFeedback(null);
    const { error } = await supabase
      .schema("zecontrol")
      .from("work_calendar_exceptions")
      .insert({
        organisation_id: organisationId,
        work_date: workDate,
        target_type: targetType,
        service_name: targetType === "service" ? targetValue : null,
        profile_id: targetType === "profile" ? targetValue : null,
        label: cleanLabel,
        created_by: profileId,
      });
    setSaving(false);

    if (error) {
      console.error("zecontrol_non_working_day_create_failed", {
        code: error.code,
        organisation_id: organisationId,
        target_type: targetType,
      });
      setFeedback({
        type: "error",
        message: error.code === "23505"
          ? "Cette journée est déjà configurée pour cette cible."
          : "La journée non travaillée n’a pas pu être enregistrée. Réessayez ou contactez l’assistance.",
      });
      return;
    }

    setFeedback({ type: "success", message: "La journée est maintenant considérée comme non travaillée." });
    await reload();
  }

  async function removeException(id: string) {
    setSaving(true);
    setFeedback(null);
    const { error } = await supabase
      .schema("zecontrol")
      .from("work_calendar_exceptions")
      .delete()
      .eq("id", id)
      .eq("organisation_id", organisationId);
    setSaving(false);
    if (error) {
      setFeedback({ type: "error", message: "Cette exception n’a pas pu être supprimée." });
      return;
    }
    setFeedback({ type: "success", message: "La journée travaillée habituelle est rétablie." });
    await reload();
  }

  function targetLabel(exception: CalendarException) {
    if (exception.target_type === "organisation") return "Toute l’organisation";
    if (exception.target_type === "service") return exception.service_name || "Service indisponible";
    return profileById.get(exception.profile_id ?? "")?.fullname ?? "Collaborateur indisponible";
  }

  if (loading) {
    return <div className="settings-loading"><LoaderCircle className="spin" size={20} /> Chargement du calendrier...</div>;
  }

  return (
    <section className="non-working-days">
      <header>
        <span><CalendarOff size={21} /></span>
        <div><small>Exceptions du calendrier</small><h2>Journées non travaillées</h2><p>Neutralisez les attentes, retards et absences pour une date précise.</p></div>
        <em>{exceptions.length} journée{exceptions.length > 1 ? "s" : ""}</em>
      </header>

      <div className="non-working-days-content">
        {feedback && <div className={`form-message form-${feedback.type}`} role={feedback.type === "error" ? "alert" : "status"}>{feedback.type === "success" ? <Check size={15} /> : <AlertTriangle size={15} />} {feedback.message}</div>}

        <div className="non-working-day-form">
          <label><span>Date</span><input type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} /></label>
          <label><span>Libellé</span><textarea value={label} maxLength={120} rows={3} onChange={(event) => setLabel(event.target.value)} placeholder="Ex. Fête nationale" /><small>{label.length}/120</small></label>

          <div className="non-working-target-choice" role="group" aria-label="Périmètre de la journée non travaillée">
            <button className={targetType === "organisation" ? "is-selected" : ""} type="button" onClick={() => chooseTarget("organisation")}><Building2 size={17} /><span><strong>Global</strong><small>Toute l’organisation</small></span></button>
            <button className={targetType === "service" ? "is-selected" : ""} type="button" onClick={() => chooseTarget("service")} disabled={!services.length}><UsersRound size={17} /><span><strong>Service</strong><small>Un service précis</small></span></button>
            <button className={targetType === "profile" ? "is-selected" : ""} type="button" onClick={() => chooseTarget("profile")} disabled={!profiles.length}><UserRound size={17} /><span><strong>Collaborateur</strong><small>Une seule personne</small></span></button>
          </div>

          {targetType !== "organisation" && <label className="non-working-target-select"><span>{targetType === "service" ? "Service concerné" : "Collaborateur concerné"}</span><select value={targetValue} onChange={(event) => setTargetValue(event.target.value)}>{targetType === "service" ? services.map((service) => <option value={service} key={service}>{service}</option>) : profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.fullname}{profile.service ? ` · ${profile.service}` : ""}</option>)}</select></label>}

          <button className="button button-primary non-working-day-submit" type="button" onClick={() => void addException()} disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Ajouter la journée</button>
        </div>

        <div className="non-working-day-list">
          {exceptions.map((exception) => <article key={exception.id}>
            <time dateTime={exception.work_date}><strong>{new Intl.DateTimeFormat("fr-FR", { day: "2-digit" }).format(new Date(`${exception.work_date}T12:00:00`))}</strong><span>{new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric" }).format(new Date(`${exception.work_date}T12:00:00`))}</span></time>
            <div><small>{exception.target_type === "organisation" ? "Global" : exception.target_type === "service" ? "Service" : "Collaborateur"}</small><strong>{exception.label}</strong><p>{targetLabel(exception)}</p></div>
            <button type="button" onClick={() => void removeException(exception.id)} disabled={saving} aria-label={`Supprimer ${exception.label}`}><Trash2 size={16} /></button>
          </article>)}
          {!exceptions.length && <div className="non-working-day-empty"><CalendarOff size={24} /><strong>Aucune exception</strong><p>Toutes les journées suivent actuellement les horaires habituels.</p></div>}
        </div>
      </div>
    </section>
  );
}
