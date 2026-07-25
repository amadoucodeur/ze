import "server-only";

import { cache } from "react";
import { createAdminClient } from "./admin";
import { createClient } from "./server";

export type ZeSuiteRole = "owner" | "admin" | "recruiter" | "viewer";
export type ZeControlRole = "owner" | "admin" | "agent";
export type ZeControlAccessStatus =
  | "ready"
  | "profile-inactive"
  | "organisation-missing"
  | "organisation-inactive"
  | "product-inactive";

export type ZeControlContext = {
  status: ZeControlAccessStatus;
  profile: {
    id: string;
    fullname: string;
    identifiant: string;
    email: string | null;
    phone: string | null;
    role: ZeSuiteRole;
    organisation_id: string | null;
    is_active: boolean;
    must_change_password: boolean;
  };
  organisation: {
    id: string;
    name: string;
    identifiant: string;
    status: "active" | "suspended" | "archived";
    timezone: string;
  } | null;
  productProfile: {
    id: string;
    role: ZeControlRole;
    is_active: boolean;
    policy: "strict" | "flexible" | "free";
    can_remote: boolean;
    poste: string | null;
    service: string | null;
  } | null;
};

export async function getZeControlAccess(
  userId: string,
): Promise<ZeControlContext | null> {
  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select(
      "id, fullname, identifiant, email, phone, role, organisation_id, is_active, must_change_password",
    )
    .eq("id", userId)
    .maybeSingle();

  if (profileError || !profile) return null;

  const typedProfile = profile as ZeControlContext["profile"];
  if (!typedProfile.is_active) {
    return {
      status: "profile-inactive",
      profile: typedProfile,
      organisation: null,
      productProfile: null,
    };
  }

  if (!typedProfile.organisation_id) {
    return {
      status: "organisation-missing",
      profile: typedProfile,
      organisation: null,
      productProfile: null,
    };
  }

  const [organisationResult, organisationConfigResult, productProfileResult] =
    await Promise.all([
      admin
        .from("organisations")
        .select("id, name, identifiant, status")
        .eq("id", typedProfile.organisation_id)
        .maybeSingle(),
      (async () => {
        const result = await admin
          .schema("zecontrol")
          .from("orga_configs")
          .select("id, is_active, timezone")
          .eq("id", typedProfile.organisation_id)
          .maybeSingle();

        if (
          result.error &&
          /timezone|column .* does not exist/i.test(result.error.message)
        ) {
          return admin
            .schema("zecontrol")
            .from("orga_configs")
            .select("id, is_active")
            .eq("id", typedProfile.organisation_id)
            .maybeSingle();
        }

        return result;
      })(),
      admin
        .schema("zecontrol")
        .from("profiles_configs")
        .select("id, role, is_active, policy, can_remote, poste, service")
        .eq("id", typedProfile.id)
        .maybeSingle(),
    ]);

  if (
    organisationResult.error ||
    organisationConfigResult.error ||
    productProfileResult.error
  ) {
    return null;
  }

  const organisation = organisationResult.data;
  const organisationConfig = organisationConfigResult.data as {
    id: string;
    is_active: boolean;
    timezone?: string | null;
  } | null;
  const productProfile = productProfileResult.data;

  const typedOrganisation = organisation
    ? {
        ...organisation,
        timezone: organisationConfig?.timezone || "Africa/Abidjan",
      } as ZeControlContext["organisation"]
    : null;
  const typedProductProfile =
    (productProfile as ZeControlContext["productProfile"]) ?? null;

  if (!typedOrganisation || typedOrganisation.status !== "active") {
    return {
      status: "organisation-inactive",
      profile: typedProfile,
      organisation: typedOrganisation,
      productProfile: typedProductProfile,
    };
  }

  if (!organisationConfig?.is_active || !typedProductProfile?.is_active) {
    return {
      status: "product-inactive",
      profile: typedProfile,
      organisation: typedOrganisation,
      productProfile: typedProductProfile,
    };
  }

  return {
    status: "ready",
    profile: typedProfile,
    organisation: typedOrganisation,
    productProfile: typedProductProfile,
  };
}

export const getCurrentZeControlAccess = cache(
  async (): Promise<ZeControlContext | null> => {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    if (!userId) return null;
    return getZeControlAccess(userId);
  },
);
