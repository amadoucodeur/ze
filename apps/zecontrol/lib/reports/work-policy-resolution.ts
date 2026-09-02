import { isWorkPolicyDefinition, type WorkPolicyDefinition } from "@/lib/work-policy";

export type ReportWorkPolicy = {
  id: string;
  is_enabled: boolean;
  is_default: boolean;
};

export type ReportWorkPolicyVersion = {
  policy_id: string;
  definition: unknown;
  effective_from: string;
  version_number: number;
};

export type ReportWorkPolicyAssignment = {
  policy_id: string;
  target_type: "organisation" | "service" | "team" | "profile";
  service_name: string | null;
  team_id: string | null;
  profile_id: string | null;
  valid_from: string;
  valid_until: string | null;
  priority: number;
  created_at?: string;
};

export type ReportTeamMember = {
  team_id: string;
  profile_id: string;
  is_active: boolean;
};

export type ReportWorkCalendarException = {
  work_date: string;
  target_type: "organisation" | "service" | "profile";
  service_name: string | null;
  profile_id: string | null;
};

export function resolveReportWorkPolicy({
  profileId,
  service,
  day,
  policies,
  versions,
  assignments,
  teamMembers,
  calendarExceptions = [],
}: {
  profileId: string;
  service: string | null;
  day: string;
  policies: ReportWorkPolicy[];
  versions: ReportWorkPolicyVersion[];
  assignments: ReportWorkPolicyAssignment[];
  teamMembers: ReportTeamMember[];
  calendarExceptions?: ReportWorkCalendarException[];
}): WorkPolicyDefinition | null {
  const policyById = new Map(policies.map((policy) => [policy.id, policy]));
  const profileTeams = new Set(
    teamMembers
      .filter((member) => member.profile_id === profileId && member.is_active)
      .map((member) => member.team_id),
  );
  const defaultPolicy = policies.find(
    (policy) => policy.is_default && policy.is_enabled,
  );
  const matching = assignments
    .filter((assignment) => {
      const policy = policyById.get(assignment.policy_id);
      if (!policy?.is_enabled) return false;
      if (
        assignment.valid_from > day ||
        (assignment.valid_until && assignment.valid_until < day)
      ) {
        return false;
      }
      if (assignment.target_type === "profile") {
        return assignment.profile_id === profileId;
      }
      if (assignment.target_type === "team") {
        return Boolean(
          assignment.team_id && profileTeams.has(assignment.team_id),
        );
      }
      if (assignment.target_type === "service") {
        return Boolean(
          assignment.service_name &&
          service &&
          assignment.service_name.trim().toLocaleLowerCase("fr") ===
            service.trim().toLocaleLowerCase("fr"),
        );
      }
      return assignment.target_type === "organisation";
    })
    .sort((first, second) => {
      const ranks = {
        organisation: 100,
        service: 200,
        team: 300,
        profile: 400,
      };
      return (
        ranks[second.target_type] +
          second.priority -
          (ranks[first.target_type] + first.priority) ||
        second.valid_from.localeCompare(first.valid_from) ||
        (second.created_at ?? "").localeCompare(first.created_at ?? "")
      );
    });
  const policyId = matching[0]?.policy_id ?? defaultPolicy?.id;
  if (!policyId) return null;

  const version = versions
    .filter(
      (candidate) =>
        candidate.policy_id === policyId && candidate.effective_from <= day,
    )
    .sort(
      (first, second) =>
        second.effective_from.localeCompare(first.effective_from) ||
        second.version_number - first.version_number,
    )[0];

  if (!isWorkPolicyDefinition(version?.definition)) return null;

  const isNonWorkingDay = calendarExceptions.some((exception) => {
    if (exception.work_date !== day) return false;
    if (exception.target_type === "profile") {
      return exception.profile_id === profileId;
    }
    if (exception.target_type === "service") {
      return Boolean(
        exception.service_name &&
        service &&
        exception.service_name.trim().toLocaleLowerCase("fr") ===
          service.trim().toLocaleLowerCase("fr"),
      );
    }
    return exception.target_type === "organisation";
  });
  const weekday = new Date(`${day}T12:00:00`).getDay() || 7;

  return {
    ...version.definition,
    days: isNonWorkingDay
      ? version.definition.days.filter((candidate) => candidate !== weekday)
      : version.definition.days,
    daySchedules: version.definition.daySchedules ?? {},
  };
}
