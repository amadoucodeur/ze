import { describe, expect, it } from "vitest";
import { defaultWorkPolicies } from "../work-policy";
import { resolveReportWorkPolicy } from "./work-policy-resolution";

describe("resolveReportWorkPolicy", () => {
  it("uses creation time as the final deterministic assignment tie-breaker", () => {
    const definition = resolveReportWorkPolicy({
      profileId: "profile-1",
      service: "Finance",
      day: "2026-09-01",
      policies: [
        { id: "old", is_enabled: true, is_default: false },
        { id: "new", is_enabled: true, is_default: false },
      ],
      versions: [
        { policy_id: "old", definition: { ...defaultWorkPolicies.fixed, startTime: "08:00" }, effective_from: "2026-01-01", version_number: 1 },
        { policy_id: "new", definition: { ...defaultWorkPolicies.fixed, startTime: "09:00" }, effective_from: "2026-01-01", version_number: 1 },
      ],
      assignments: [
        { policy_id: "old", target_type: "organisation", service_name: null, team_id: null, profile_id: null, valid_from: "2026-01-01", valid_until: null, priority: 0, created_at: "2026-01-01T08:00:00Z" },
        { policy_id: "new", target_type: "organisation", service_name: null, team_id: null, profile_id: null, valid_from: "2026-01-01", valid_until: null, priority: 0, created_at: "2026-01-02T08:00:00Z" },
      ],
      teamMembers: [],
    });
    expect(definition?.startTime).toBe("09:00");
  });
});
