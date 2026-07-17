"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  message?: string;
  success?: string;
  errors?: Record<string, string[]>;
};

const credentialsSchema = z.object({
  identifiant: z
    .string()
    .trim()
    .min(3, "Saisissez l’identifiant fourni par votre organisation.")
    .max(80, "Cet identifiant est trop long."),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères."),
});

const passwordSchema = z
  .object({
    password: z.string().min(8, "Utilisez au moins 8 caractères."),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Les deux mots de passe ne correspondent pas.",
    path: ["confirmPassword"],
  });

async function requestOrigin() {
  const requestHeaders = await headers();
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  return host ? `${protocol}://${host}` : process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export async function loginAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentialsSchema.safeParse({
    identifiant: formData.get("identifiant"),
    password: formData.get("password"),
  });

  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, is_active, must_change_password, organisation_id, role")
    .eq("identifiant", parsed.data.identifiant)
    .maybeSingle();

  const isOrganisationMember =
    profile?.is_active &&
    profile.organisation_id !== null &&
    profile.role !== "owner";

  // Une adresse factice conserve une réponse uniforme lorsque l’identifiant
  // n’existe pas, est inactif ou ne possède pas d’email d’authentification.
  const authenticationEmail =
    isOrganisationMember && profile.email
      ? profile.email
      : "invalid-user@auth.zerecruit.invalid";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: authenticationEmail,
    password: parsed.data.password,
  });

  if (
    error ||
    !data.user ||
    !isOrganisationMember ||
    data.user.id !== profile.id
  ) {
    if (data.user) await supabase.auth.signOut();
    return { message: "Identifiant ou mot de passe incorrect. Vérifiez vos informations." };
  }

  await admin.from("profiles").update({
    last_login_at: new Date().toISOString(),
  }).eq("id", profile.id);

  redirect(profile.must_change_password ? "/nouveau-mot-de-passe" : "/dashboard");
}

export async function googleSignupAction() {
  const supabase = await createClient();
  const origin = await requestOrigin();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=/dashboard`,
      queryParams: { prompt: "select_account" },
    },
  });

  if (error || !data.url) redirect("/auth/auth-code-error");
  redirect(data.url);
}

export async function requestPasswordResetAction(
  _state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = z.string().trim().min(3).max(80).safeParse(formData.get("identifiant"));
  if (!parsed.success) {
    return { errors: { identifiant: ["Saisissez votre identifiant ZeRecruit."] } };
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("email, is_active, organisation_id, role")
    .eq("identifiant", parsed.data)
    .maybeSingle();
  const isOrganisationMember =
    profile?.is_active &&
    profile.organisation_id !== null &&
    profile.role !== "owner";
  const supabase = await createClient();
  const origin = await requestOrigin();
  await supabase.auth.resetPasswordForEmail(
    isOrganisationMember && profile.email
      ? profile.email
      : "invalid-user@auth.zerecruit.invalid",
    {
      redirectTo: `${origin}/auth/callback?next=/nouveau-mot-de-passe`,
    },
  );

  return { success: "Si cet identifiant correspond à un compte actif, un lien sécurisé a été envoyé à l’adresse associée." };
}

export async function updatePasswordAction(
  _state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { message: "Le mot de passe n’a pas pu être modifié. Demandez un nouveau lien." };

  if (data.user) {
    const admin = createAdminClient();
    await admin
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", data.user.id);
  }

  redirect("/dashboard?password=updated");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
