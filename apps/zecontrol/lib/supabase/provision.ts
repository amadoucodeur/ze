import "server-only";

import type { ZeControlContext } from "./access";
import { createAdminClient } from "./admin";

export type ProvisionResult = "ready" | "inactive" | "failed";

type ProvisionOptions = {
  reactivate?: boolean;
};

/**
 * Crée l'accès propriétaire lors de sa première entrée dans ZeControl.
 * Une désactivation explicite n'est jamais annulée automatiquement.
 */
export async function ensureZeControlOwnerAccess(
  access: ZeControlContext,
  options: ProvisionOptions = {},
): Promise<ProvisionResult> {
  if (
    access.profile.role !== "owner" ||
    !access.profile.is_active ||
    !access.organisation ||
    access.organisation.status !== "active"
  ) {
    return "failed";
  }
  if (access.status === "ready") return "ready";

  const admin = createAdminClient();
  const [organisationConfigResult, profileConfigResult] = await Promise.all([
    admin
      .schema("zecontrol")
      .from("orga_configs")
      .select("id, is_active")
      .eq("id", access.organisation.id)
      .maybeSingle(),
    admin
      .schema("zecontrol")
      .from("profiles_configs")
      .select("id, is_active")
      .eq("id", access.profile.id)
      .maybeSingle(),
  ]);

  if (organisationConfigResult.error || profileConfigResult.error) {
    return "failed";
  }

  const previousOrganisationConfig = organisationConfigResult.data;
  const previousProfileConfig = profileConfigResult.data;
  if (
    !options.reactivate &&
    (previousOrganisationConfig?.is_active === false ||
      previousProfileConfig?.is_active === false)
  ) {
    return "inactive";
  }

  const now = new Date().toISOString();
  const { error: organisationConfigError } = await admin
    .schema("zecontrol")
    .from("orga_configs")
    .upsert(
      { id: access.organisation.id, is_active: true, updated_at: now },
      { onConflict: "id" },
    );

  if (organisationConfigError) return "failed";

  const { error: profileConfigError } = await admin
    .schema("zecontrol")
    .from("profiles_configs")
    .upsert(
      {
        id: access.profile.id,
        role: "owner",
        is_active: true,
        updated_at: now,
      },
      { onConflict: "id" },
    );

  if (!profileConfigError) return "ready";

  if (previousOrganisationConfig) {
    await admin
      .schema("zecontrol")
      .from("orga_configs")
      .update({
        is_active: previousOrganisationConfig.is_active,
        updated_at: now,
      })
      .eq("id", access.organisation.id);
  } else {
    await admin
      .schema("zecontrol")
      .from("orga_configs")
      .delete()
      .eq("id", access.organisation.id);
  }

  return "failed";
}
