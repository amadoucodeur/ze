import "server-only";

import { createAdminClient } from "./admin";
import { createClient } from "./server";

export type ProfileRole = "owner" | "admin" | "recruiter" | "viewer";

export type CurrentOrganisation = {
  id: string;
  name: string;
  identifiant: string;
  email: string | null;
  phone: string | null;
  website_url: string | null;
  description: string | null;
  logo_url: string | null;
  plan: string;
  status: "active" | "suspended" | "archived";
  settings: Record<string, unknown> | null;
};

export type CurrentProfile = {
  id: string;
  fullname: string;
  identifiant: string;
  phone: string | null;
  email: string | null;
  role: ProfileRole;
  organisation_id: string | null;
  is_active: boolean;
  must_change_password: boolean;
  organisation: CurrentOrganisation | null;
};

export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, fullname, identifiant, phone, email, role, organisation_id, is_active, must_change_password")
    .eq("id", userId)
    .maybeSingle();

  if (error || !profile || !profile.is_active) return null;

  let organisation: CurrentOrganisation | null = null;
  if (profile.organisation_id) {
    const { data } = await admin
      .from("organisations")
      .select("id, name, identifiant, email, phone, website_url, description, logo_url, plan, status, settings")
      .eq("id", profile.organisation_id)
      .maybeSingle();
    organisation = data as CurrentOrganisation | null;
  }

  return {
    ...profile,
    role: profile.role as ProfileRole,
    organisation,
  };
}
