"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { composeAuthEmail, LOGIN_IDENTIFIER_PATTERN } from "@/lib/identifiers";
import { getZeControlAccess } from "@/lib/supabase/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { applicationOrigin } from "@/lib/application-origin";

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
    .regex(
      LOGIN_IDENTIFIER_PATTERN,
      "Utilisez le format utilisateur@organisation, par exemple amadou@trabad.",
    ),
  password: z
    .string()
    .min(8, "Le mot de passe doit contenir au moins 8 caractères."),
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

function accessDestination(
  access: Awaited<ReturnType<typeof getZeControlAccess>>,
) {
  if (!access) return "/auth/auth-code-error?reason=profile";
  if (access.profile.must_change_password) return "/nouveau-mot-de-passe";
  if (
    access.status === "organisation-missing" &&
    access.profile.role === "owner"
  ) {
    return "/dashboard/organisation/nouvelle";
  }
  return access.status === "ready" ? "/dashboard" : "/activation";
}

export async function loginAction(
  _state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = credentialsSchema.safeParse({
    identifiant: formData.get("identifiant"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: composeAuthEmail(parsed.data.identifiant),
    password: parsed.data.password,
  });

  if (error || !data.user) {
    const isSuspended =
      error?.code === "user_banned" ||
      error?.message.toLowerCase().includes("banned");
    return isSuspended
      ? {
          message:
            "Votre compte ZeSuite est suspendu. Contactez l’administrateur de votre organisation.",
        }
      : {
          message:
            "Identifiant ou mot de passe incorrect. Vérifiez vos informations.",
        };
  }

  const access = await getZeControlAccess(data.user.id);
  const isOrganisationMember =
    access?.profile.organisation_id !== null &&
    access?.profile.role !== "owner" &&
    access?.profile.identifiant === parsed.data.identifiant;

  if (!access) {
    await supabase.auth.signOut();
    return {
      message:
        "Ce compte n’est pas rattaché à un profil ZeSuite. Vérifiez le compte utilisé.",
    };
  }

  if (!access.profile.is_active || !isOrganisationMember) {
    await supabase.auth.signOut();
    return {
      message: !access.profile.is_active
        ? "Votre compte ZeSuite est suspendu. Contactez l’administrateur de votre organisation."
        : "Cet accès n’est plus rattaché à une organisation. Contactez votre administrateur.",
    };
  }

  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", access.profile.id);

  redirect(accessDestination(access));
}

export async function googleSignupAction() {
  const supabase = await createClient();
  const origin = applicationOrigin();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/dashboard/organisation/nouvelle")}`,
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
  const parsed = z
    .string()
    .trim()
    .toLowerCase()
    .min(7)
    .max(100)
    .regex(LOGIN_IDENTIFIER_PATTERN)
    .safeParse(formData.get("identifiant"));

  if (!parsed.success) {
    return {
      errors: {
        identifiant: [
          "Saisissez votre identifiant complet, par exemple amadou@trabad.",
        ],
      },
    };
  }

  return {
    success:
      "Demandez au propriétaire ou à un administrateur de votre organisation de réinitialiser votre mot de passe.",
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
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return {
      message:
        "Le mot de passe n’a pas pu être modifié. Demandez un nouveau lien à votre administrateur.",
    };
  }

  if (data.user) {
    const admin = createAdminClient();
    await admin
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", data.user.id);
    redirect(accessDestination(await getZeControlAccess(data.user.id)));
  }

  redirect("/connexion");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
