"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { composeAuthEmail, LOGIN_IDENTIFIER_PATTERN } from "@/lib/identifiers";

export type AuthState = {
  message?: string;
  success?: string;
  errors?: Record<string, string[]>;
};

const credentialsSchema = z.object({
  identifiant: z
    .string()
    .trim()
    .toLowerCase()
    .min(7, "Saisissez l’identifiant complet fourni par votre organisation.")
    .max(100, "Cet identifiant est trop long.")
    .regex(LOGIN_IDENTIFIER_PATTERN, "Utilisez le format utilisateur@organisation, par exemple amadou@trabad."),
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

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: composeAuthEmail(parsed.data.identifiant),
    password: parsed.data.password,
  });

  if (error) {
    const isSuspended = error.code === "user_banned" || error.message.toLowerCase().includes("banned");
    return isSuspended
      ? { message: "Votre accès a été suspendu par votre organisation. Contactez votre administrateur pour le réactiver." }
      : { message: "Identifiant ou mot de passe incorrect. Vérifiez vos informations." };
  }

  if (!data.user) {
    return { message: "Identifiant ou mot de passe incorrect. Vérifiez vos informations." };
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, identifiant, is_active, must_change_password, organisation_id, role")
    .eq("id", data.user.id)
    .maybeSingle();
  const isOrganisationMember =
    profile?.organisation_id !== null &&
    profile?.role !== "owner" &&
    profile?.identifiant === parsed.data.identifiant;

  if (!profile?.is_active || !isOrganisationMember) {
    await supabase.auth.signOut();
    return !profile?.is_active
      ? { message: "Votre accès a été suspendu par votre organisation. Contactez votre administrateur pour le réactiver." }
      : { message: "Cet accès n’est plus rattaché à une organisation. Contactez votre administrateur." };
  }

  await admin.from("profiles").update({
    last_login_at: new Date().toISOString(),
  }).eq("id", profile.id);

  redirect(profile.must_change_password ? "/nouveau-mot-de-passe" : "/dashboard");
}

export async function googleSignupAction(formData: FormData) {
  const supabase = await createClient();
  const origin = await requestOrigin();
  const plan = z.enum(["free", "essential", "team", "scale"]).safeParse(formData.get("plan"));
  const cycle = formData.get("cycle") === "year" ? "year" : "month";
  const next = plan.success && plan.data !== "free"
    ? `/dashboard/organisation/nouvelle?plan=${plan.data}&cycle=${cycle}`
    : "/dashboard/organisation/nouvelle";
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
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
  const parsed = z.string().trim().toLowerCase().min(7).max(100).regex(LOGIN_IDENTIFIER_PATTERN).safeParse(formData.get("identifiant"));
  if (!parsed.success) {
    return { errors: { identifiant: ["Saisissez votre identifiant complet, par exemple amadou@trabad."] } };
  }

  return {
    success: "Pour protéger votre organisation, demandez à son propriétaire de réinitialiser votre mot de passe depuis la gestion de l’équipe.",
  };
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
