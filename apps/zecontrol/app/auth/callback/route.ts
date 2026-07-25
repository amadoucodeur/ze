import { NextResponse } from "next/server";
import { getZeControlAccess } from "@/lib/supabase/access";
import { ensureProfile } from "@/lib/supabase/profile";
import { ensureZeControlOwnerAccess } from "@/lib/supabase/provision";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  let next = url.searchParams.get("next") ?? "/dashboard";
  if (next !== "/dashboard/organisation/nouvelle") next = "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      try {
        const authenticatedWithGoogle =
          data.user.app_metadata.provider === "google" ||
          data.user.app_metadata.providers?.includes("google");

        if (!authenticatedWithGoogle) {
          await supabase.auth.signOut();
          return NextResponse.redirect(
            `${url.origin}/auth/auth-code-error?reason=login-method`,
          );
        }

        await ensureProfile(data.user);
        let access = await getZeControlAccess(data.user.id);

        if (!access) {
          return NextResponse.redirect(
            `${url.origin}/auth/auth-code-error?reason=profile`,
          );
        }

        if (
          access.profile.role !== "owner" ||
          !access.profile.is_active
        ) {
          await supabase.auth.signOut();
          return NextResponse.redirect(
            `${url.origin}/auth/auth-code-error?reason=login-method`,
          );
        }

        if (access.status === "product-inactive") {
          const provisionResult = await ensureZeControlOwnerAccess(access);
          if (provisionResult === "ready") {
            access = await getZeControlAccess(data.user.id);
          } else if (provisionResult === "failed") {
            return NextResponse.redirect(
              `${url.origin}/activation?error=activation-failed`,
            );
          }
        }

        if (!access) {
          return NextResponse.redirect(
            `${url.origin}/auth/auth-code-error?reason=profile`,
          );
        }

        const destination = access.profile.must_change_password
          ? "/nouveau-mot-de-passe"
          : access.status === "organisation-missing"
            ? next
          : access.status === "ready"
            ? "/dashboard"
            : "/activation";
        const forwardedHost = request.headers.get("x-forwarded-host");
        const origin =
          process.env.NODE_ENV === "development" || !forwardedHost
            ? url.origin
            : `https://${forwardedHost}`;
        return NextResponse.redirect(`${origin}${destination}`);
      } catch {
        return NextResponse.redirect(
          `${url.origin}/auth/auth-code-error?reason=profile`,
        );
      }
    }
  }

  return NextResponse.redirect(`${url.origin}/auth/auth-code-error`);
}
