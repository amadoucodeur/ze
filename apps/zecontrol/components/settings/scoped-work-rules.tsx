"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Clock3,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  defaultWorkPolicies,
  isWorkPolicyDefinition,
  policySummary,
  weekdayOptions,
  type WorkPolicyDefinition,
  type WorkPolicyMode,
} from "@/lib/work-policy";
import { DailyScheduleOverrides } from "./daily-schedule-overrides";

type ProfileOption = {
  id: string;
  fullname: string;
  poste: string | null;
  service: string | null;
};

type WorkTeam = {
  id: string;
  name: string;
  is_active: boolean;
};

type TeamMember = { team_id: string; profile_id: string; is_active: boolean };
type PolicyRow = { id: string; name: string; is_enabled: boolean };
type AssignmentRow = {
  id: string;
  policy_id: string;
  target_type: "team" | "profile" | "service" | "organisation";
  team_id: string | null;
  profile_id: string | null;
  valid_from: string;
};
type VersionRow = {
  policy_id: string;
  version_number: number;
  definition: unknown;
  effective_from: string;
};

function localDate(timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function copyDefault(mode: WorkPolicyMode) {
  return {
    ...defaultWorkPolicies[mode],
    days: [...defaultWorkPolicies[mode].days],
    daySchedules: {},
  };
}

export function ScopedWorkRules({
  organisationId,
  profileId,
  timeZone,
}: {
  organisationId: string;
  profileId: string;
  timeZone: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const today = useMemo(() => localDate(timeZone), [timeZone]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(true);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [teams, setTeams] = useState<WorkTeam[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [view, setView] = useState<"rules" | "teams">("rules");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [targetType, setTargetType] = useState<"team" | "profile">("team");
  const [targetId, setTargetId] = useState("");
  const [definition, setDefinition] = useState<WorkPolicyDefinition>(copyDefault("fixed"));
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; message: string } | null>(null);
  const [teamName, setTeamName] = useState("");
  const [teamProfileIds, setTeamProfileIds] = useState<string[]>([]);

  async function reload() {
    const [profilesResult, teamsResult, membersResult, policiesResult, assignmentsResult, versionsResult] =
      await Promise.all([
        supabase.schema("zecontrol").rpc("list_report_profiles", {
          target_organisation_id: organisationId,
        }),
        supabase.schema("zecontrol").from("work_teams").select("id, name, is_active").eq("organisation_id", organisationId).order("name"),
        supabase.schema("zecontrol").from("work_team_members").select("team_id, profile_id, is_active"),
        supabase.schema("zecontrol").from("work_policies").select("id, name, is_enabled").eq("organisation_id", organisationId).eq("is_default", false).order("created_at"),
        supabase.schema("zecontrol").from("work_policy_assignments").select("id, policy_id, target_type, team_id, profile_id, valid_from").eq("organisation_id", organisationId).in("target_type", ["team", "profile"]),
        supabase.schema("zecontrol").from("work_policy_versions").select("policy_id, version_number, definition, effective_from").order("effective_from", { ascending: false }),
      ]);

    if (
      profilesResult.error ||
      teamsResult.error ||
      membersResult.error ||
      policiesResult.error ||
      assignmentsResult.error ||
      versionsResult.error
    ) {
      setAvailable(false);
      setLoading(false);
      return;
    }

    setProfiles((profilesResult.data ?? []) as ProfileOption[]);
    setTeams((teamsResult.data ?? []) as WorkTeam[]);
    setMembers((membersResult.data ?? []) as TeamMember[]);
    setPolicies((policiesResult.data ?? []) as PolicyRow[]);
    setAssignments((assignmentsResult.data ?? []) as AssignmentRow[]);
    setVersions((versionsResult.data ?? []) as VersionRow[]);
    setAvailable(true);
    setLoading(false);
  }

  useEffect(() => {
    // The state updates happen only after the asynchronous Supabase requests.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisationId, supabase]);

  const targetedRules = assignments
    .map((assignment) => {
      const policy = policies.find((candidate) => candidate.id === assignment.policy_id);
      if (!policy) return null;
      const target =
        assignment.target_type === "team"
          ? teams.find((team) => team.id === assignment.team_id)?.name
          : profiles.find((profile) => profile.id === assignment.profile_id)?.fullname;
      const version = versions.find((candidate) => candidate.policy_id === policy.id);
      return { assignment, policy, target: target ?? "Cible indisponible", version };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  function startNewRule() {
    const defaultTargetType = teams.length ? "team" : "profile";
    setEditingAssignmentId(null);
    setTargetType(defaultTargetType);
    setTargetId(defaultTargetType === "team" ? teams[0]?.id ?? "" : profiles[0]?.id ?? "");
    setDefinition(copyDefault("fixed"));
    setEffectiveFrom(today);
    setFeedback(null);
    setEditorOpen(true);
  }

  function editRule(item: (typeof targetedRules)[number]) {
    setEditingAssignmentId(item.assignment.id);
    setTargetType(item.assignment.target_type as "team" | "profile");
    setTargetId(item.assignment.team_id ?? item.assignment.profile_id ?? "");
    setDefinition(isWorkPolicyDefinition(item.version?.definition) ? {
      ...item.version.definition,
      daySchedules: item.version.definition.daySchedules ?? {},
    } : copyDefault("fixed"));
    setEffectiveFrom(today);
    setFeedback(null);
    setEditorOpen(true);
  }

  function toggleDay(day: number) {
    setDefinition((current) => ({
      ...current,
      days: current.days.includes(day)
        ? current.days.filter((candidate) => candidate !== day)
        : [...current.days, day].sort((a, b) => a - b),
    }));
  }

  async function saveTeam() {
    const cleanName = teamName.trim();
    if (cleanName.length < 2) {
      setFeedback({ type: "error", message: "Donnez un nom à l’équipe." });
      return;
    }
    if (!teamProfileIds.length) {
      setFeedback({ type: "error", message: "Choisissez au moins un collaborateur." });
      return;
    }

    setSaving(true);
    setFeedback(null);
    const { data: team, error: teamError } = await supabase
      .schema("zecontrol")
      .from("work_teams")
      .insert({
        organisation_id: organisationId,
        name: cleanName,
        created_by: profileId,
      })
      .select("id")
      .single();
    if (teamError || !team) {
      setSaving(false);
      setFeedback({ type: "error", message: "Cette équipe n’a pas pu être créée." });
      return;
    }

    const { error: membersError } = await supabase
      .schema("zecontrol")
      .from("work_team_members")
      .insert(
        teamProfileIds.map((memberProfileId) => ({
          team_id: team.id,
          profile_id: memberProfileId,
          added_by: profileId,
        })),
      );
    setSaving(false);
    if (membersError) {
      setFeedback({ type: "error", message: "L’équipe existe, mais ses membres n’ont pas pu être ajoutés." });
      return;
    }

    setTeamName("");
    setTeamProfileIds([]);
    setFeedback({ type: "success", message: "L’équipe est prête à recevoir son propre horaire." });
    await reload();
  }

  async function saveTargetedRule() {
    if (!targetId) {
      setFeedback({ type: "error", message: "Choisissez une équipe ou un collaborateur." });
      return;
    }
    if (
      !editingAssignmentId &&
      assignments.some((assignment) =>
        assignment.target_type === targetType &&
        (targetType === "team"
          ? assignment.team_id === targetId
          : assignment.profile_id === targetId),
      )
    ) {
      setFeedback({ type: "error", message: "Cette cible possède déjà une règle. Modifiez la règle existante." });
      return;
    }
    if (definition.mode !== "attendance" && !definition.days.length) {
      setFeedback({ type: "error", message: "Choisissez au moins un jour travaillé." });
      return;
    }
    if (
      definition.mode === "fixed" &&
      (
        definition.startTime >= definition.endTime ||
        definition.days.some((day) => {
          const schedule = definition.daySchedules?.[String(day)];
          return schedule ? schedule.startTime >= schedule.endTime : false;
        })
      )
    ) {
      setFeedback({ type: "error", message: "L’heure de fin doit être après l’heure de début." });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const existingAssignment = assignments.find((item) => item.id === editingAssignmentId);
      let policyId = existingAssignment?.policy_id;
      const targetLabel =
        targetType === "team"
          ? teams.find((team) => team.id === targetId)?.name
          : profiles.find((profile) => profile.id === targetId)?.fullname;

      if (!policyId) {
        const { data: createdPolicy, error: policyError } = await supabase
          .schema("zecontrol")
          .from("work_policies")
          .insert({
            organisation_id: organisationId,
            name: `Cadre · ${targetLabel ?? "Ciblé"}`,
            is_enabled: false,
            is_default: false,
            created_by: profileId,
          })
          .select("id")
          .single();
        if (policyError || !createdPolicy) throw policyError ?? new Error("policy_creation_failed");
        policyId = createdPolicy.id;
      }

      const { error: draftError } = await supabase
        .schema("zecontrol")
        .from("work_policy_drafts")
        .upsert({
          policy_id: policyId,
          definition,
          effective_from: effectiveFrom,
          updated_by: profileId,
          updated_at: new Date().toISOString(),
        });
      if (draftError) throw draftError;

      const { error: publishError } = await supabase
        .schema("zecontrol")
        .rpc("publish_work_policy", {
          target_policy_id: policyId,
          target_effective_from: effectiveFrom,
        });
      if (publishError) throw publishError;

      const assignmentPayload = {
        organisation_id: organisationId,
        policy_id: policyId,
        target_type: targetType,
        team_id: targetType === "team" ? targetId : null,
        profile_id: targetType === "profile" ? targetId : null,
        service_name: null,
        valid_from: existingAssignment?.valid_from ?? effectiveFrom,
        valid_until: null,
        priority: 0,
        created_by: profileId,
      };
      const assignmentRequest = existingAssignment
        ? supabase.schema("zecontrol").from("work_policy_assignments").update(assignmentPayload).eq("id", existingAssignment.id)
        : supabase.schema("zecontrol").from("work_policy_assignments").insert(assignmentPayload);
      const { error: assignmentError } = await assignmentRequest;
      if (assignmentError) throw assignmentError;

      setEditorOpen(false);
      setFeedback({ type: "success", message: `Le cadre propre à ${targetLabel ?? "cette cible"} est publié.` });
      await reload();
    } catch {
      setFeedback({ type: "error", message: "Cette règle ciblée n’a pas pu être enregistrée." });
    } finally {
      setSaving(false);
    }
  }

  async function disableRule(policyId: string) {
    setSaving(true);
    const { error } = await supabase
      .schema("zecontrol")
      .from("work_policies")
      .update({ is_enabled: false, updated_at: new Date().toISOString() })
      .eq("id", policyId);
    setSaving(false);
    setFeedback(error
      ? { type: "error", message: "La règle n’a pas pu être désactivée." }
      : { type: "success", message: "La règle ciblée est désactivée." });
    if (!error) await reload();
  }

  if (loading) return <div className="settings-loading"><LoaderCircle className="spin" size={20} /> Chargement des règles ciblées...</div>;
  if (!available) return null;

  return (
    <details className="scoped-work-rules">
      <summary>
        <span><UsersRound size={20} /></span>
        <div><small>Facultatif</small><strong>Équipes et horaires particuliers</strong><p>Créez des exceptions uniquement si tout le monde ne travaille pas de la même façon.</p></div>
        <em>{targetedRules.filter((item) => item.policy.is_enabled).length || "Aucune"} règle{targetedRules.filter((item) => item.policy.is_enabled).length > 1 ? "s" : ""}</em>
        <ChevronDown size={18} />
      </summary>
      <div className="scoped-work-rules-content">
        <div className="scoped-work-tabs">
          <button className={view === "rules" ? "is-active" : ""} type="button" onClick={() => setView("rules")}><Clock3 size={15} /> Règles ciblées</button>
          <button className={view === "teams" ? "is-active" : ""} type="button" onClick={() => setView("teams")}><UsersRound size={15} /> Équipes</button>
        </div>

        {feedback && <div className={`form-message form-${feedback.type}`} role={feedback.type === "error" ? "alert" : "status"}>{feedback.type === "success" && <Check size={15} />} {feedback.message}</div>}

        {view === "rules" && (
          <>
            <div className="scoped-rule-heading">
              <div><h3>Qui a un horaire différent ?</h3><p>Une règle individuelle passe avant celle de l’équipe, puis avant la règle globale.</p></div>
              <button className="button button-ghost" type="button" onClick={startNewRule}><Plus size={15} /> Ajouter</button>
            </div>
            {targetedRules.length ? (
              <div className="scoped-rule-list">
                {targetedRules.map((item) => (
                  <article className={!item.policy.is_enabled ? "is-disabled" : ""} key={item.assignment.id}>
                    <span>{item.assignment.target_type === "team" ? <UsersRound size={17} /> : <UserRound size={17} />}</span>
                    <div><small>{item.assignment.target_type === "team" ? "Équipe" : "Collaborateur"}</small><strong>{item.target}</strong><p>{isWorkPolicyDefinition(item.version?.definition) ? policySummary(item.version.definition) : "Configuration à compléter"}</p></div>
                    <em>{item.policy.is_enabled ? "Active" : "Désactivée"}</em>
                    <button type="button" onClick={() => editRule(item)} aria-label={`Modifier ${item.target}`}><Pencil size={15} /></button>
                    {item.policy.is_enabled && <button type="button" onClick={() => void disableRule(item.policy.id)} disabled={saving} aria-label={`Désactiver ${item.target}`}><X size={15} /></button>}
                  </article>
                ))}
              </div>
            ) : (
              <div className="scoped-rule-empty"><Clock3 size={22} /><strong>Tout le monde utilise la règle globale</strong><p>Vous n’avez aucune exception à gérer.</p></div>
            )}
          </>
        )}

        {view === "teams" && (
          <div className="work-team-manager">
            <div className="work-team-list">
              {teams.map((team) => {
                const count = members.filter((member) => member.team_id === team.id && member.is_active).length;
                return <article key={team.id}><span>{team.name.slice(0, 2).toUpperCase()}</span><div><strong>{team.name}</strong><small>{count} membre{count > 1 ? "s" : ""}</small></div></article>;
              })}
              {!teams.length && <div className="scoped-rule-empty"><UsersRound size={22} /><strong>Aucune équipe</strong><p>Créez une équipe seulement si elle partage un horaire spécifique.</p></div>}
            </div>
            <section className="work-team-create">
              <h3>Nouvelle équipe</h3>
              <label><span>Nom de l’équipe</span><input value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="Ex. Équipe terrain" maxLength={80} /></label>
              <div className="work-team-member-picker">
                <span>Collaborateurs</span>
                {profiles.map((profile) => <label key={profile.id}><input type="checkbox" checked={teamProfileIds.includes(profile.id)} onChange={() => setTeamProfileIds((current) => current.includes(profile.id) ? current.filter((id) => id !== profile.id) : [...current, profile.id])} /><i>{profile.fullname.slice(0, 2).toUpperCase()}</i><span><strong>{profile.fullname}</strong><small>{[profile.poste, profile.service].filter(Boolean).join(" · ") || "Collaborateur"}</small></span></label>)}
              </div>
              <button className="button button-primary" type="button" onClick={() => void saveTeam()} disabled={saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} Créer l’équipe</button>
            </section>
          </div>
        )}
      </div>

      {editorOpen && (
        <div className="scoped-rule-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditorOpen(false); }}>
          <section className="scoped-rule-editor" role="dialog" aria-modal="true" aria-labelledby="scoped-rule-title">
            <header><div><small>Règle ciblée</small><h2 id="scoped-rule-title">{editingAssignmentId ? "Modifier cet horaire" : "Nouvel horaire particulier"}</h2></div><button type="button" onClick={() => setEditorOpen(false)} aria-label="Fermer"><X size={18} /></button></header>
            <div className="scoped-rule-editor-body">
              <div className="scoped-target-choice">
                <button className={targetType === "team" ? "is-selected" : ""} type="button" onClick={() => { setTargetType("team"); setTargetId(teams[0]?.id ?? ""); }} disabled={!teams.length || Boolean(editingAssignmentId)}><UsersRound size={17} /><span><strong>Une équipe</strong><small>{teams.length ? "Même règle pour ses membres" : "Créez d’abord une équipe"}</small></span></button>
                <button className={targetType === "profile" ? "is-selected" : ""} type="button" onClick={() => { setTargetType("profile"); setTargetId(profiles[0]?.id ?? ""); }} disabled={Boolean(editingAssignmentId)}><UserRound size={17} /><span><strong>Une personne</strong><small>Exception individuelle prioritaire</small></span></button>
              </div>
              <label className="scoped-target-select"><span>{targetType === "team" ? "Équipe concernée" : "Collaborateur concerné"}</span><select value={targetId} disabled={Boolean(editingAssignmentId)} onChange={(event) => setTargetId(event.target.value)}>{targetType === "team" ? teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>) : profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.fullname}</option>)}</select></label>
              <div className="scoped-mode-choice">
                {(["fixed", "flexible", "attendance"] as WorkPolicyMode[]).map((mode) => <button className={definition.mode === mode ? "is-selected" : ""} type="button" onClick={() => setDefinition(copyDefault(mode))} key={mode}>{mode === "fixed" ? "Fixe" : mode === "flexible" ? "Flexible" : "Présence seule"}</button>)}
              </div>
              {definition.mode !== "attendance" && <>
                <div className="work-policy-days">{weekdayOptions.map((day) => <button type="button" className={definition.days.includes(day.value) ? "is-selected" : ""} onClick={() => toggleDay(day.value)} key={day.value}><span>{day.short}</span><small>{day.label.slice(0, 3)}</small></button>)}</div>
                {definition.mode === "fixed" ? <>
                  <div className="work-policy-fields"><label><span>Début</span><div><Clock3 size={16} /><input type="time" value={definition.startTime} onChange={(event) => setDefinition({ ...definition, startTime: event.target.value })} /></div></label><label><span>Fin</span><div><Clock3 size={16} /><input type="time" value={definition.endTime} onChange={(event) => setDefinition({ ...definition, endTime: event.target.value })} /></div></label></div>
                  <DailyScheduleOverrides definition={definition} onChange={setDefinition} />
                </> : <div className="work-policy-fields"><label className="wide"><span>Temps attendu par semaine</span><div><Clock3 size={16} /><input type="number" min={1} max={168} step={0.5} value={definition.weeklyTargetMinutes / 60} onChange={(event) => setDefinition({ ...definition, weeklyTargetMinutes: Math.round(Number(event.target.value) * 60) })} /><em>heures</em></div></label></div>}
              </>}
              <label className="scoped-target-select"><span>Appliquer à partir du</span><input type="date" min={today} value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
            </div>
            <footer><button className="button button-ghost" type="button" onClick={() => setEditorOpen(false)}>Annuler</button><button className="button button-primary" type="button" onClick={() => void saveTargetedRule()} disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Publier</button></footer>
          </section>
        </div>
      )}
    </details>
  );
}
