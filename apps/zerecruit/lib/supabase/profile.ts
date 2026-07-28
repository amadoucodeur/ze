import "server-only";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "./admin";

function profileName(user: User) {
  const metadataName = user.user_metadata.full_name ?? user.user_metadata.name;
  if (typeof metadataName === "string" && metadataName.trim()) return metadataName.trim();
  return user.email?.split("@")[0] ?? "Nouveau recruteur";
}

function profileIdentifier(user: User) {
  const emailPrefix = (user.email?.split("@")[0] ?? "recruteur")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);

  return `${emailPrefix || "recruteur"}-${user.id.slice(0, 8)}`;
}

export async function ensureProfile(user: User) {
  const admin = createAdminClient();
  const { data: existing, error: lookupError } = await admin
    .from("profiles")
    .select("id, role, zerecruit_access")
    .eq("id", user.id)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (existing?.zerecruit_access) return;
  if (existing) {
    // Google is the owner-only ZeRecruit entry point. A collaborator created
    // from another ZeSuite product must be activated by its organisation,
    // never implicitly by attempting an owner login.
    if (existing.role !== "owner") {
      throw new Error("zerecruit_owner_access_required");
    }
    const { error } = await admin
      .from("profiles")
      .update({
        zerecruit_access: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);
    if (error) throw error;
    return;
  }

  const { error } = await admin.from("profiles").insert({
    id: user.id,
    email: user.email ?? null,
    fullname: profileName(user),
    identifiant: profileIdentifier(user),
    role: "owner",
    zerecruit_access: true,
    must_change_password: false,
    meta_data: user.user_metadata,
  });

  if (error && error.code !== "23505") throw error;
}
