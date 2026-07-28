import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProfile } from "@/lib/supabase/profile";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  let next = url.searchParams.get("next") ?? "/dashboard";
  if (!next.startsWith("/") || next.startsWith("//")) next = "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      try {
        const authenticatedWithGoogle =
          data.user.app_metadata.provider === "google" ||
          data.user.app_metadata.providers?.includes("google");
        const admin = createAdminClient();

        if (authenticatedWithGoogle) {
          await ensureProfile(data.user);
          const { data: profile, error: profileError } = await admin
            .from("profiles")
            .select("role, zerecruit_access")
            .eq("id", data.user.id)
            .single();

          if (profileError || profile.role !== "owner" || !profile.zerecruit_access) {
            await supabase.auth.signOut();
            return NextResponse.redirect(`${url.origin}/auth/auth-code-error?reason=login-method`);
          }
          if (!next.startsWith("/dashboard") || next.startsWith("//")) next = "/dashboard";
        } else if (next === "/nouveau-mot-de-passe") {
          const { data: profile, error: profileError } = await admin
            .from("profiles")
            .select("is_active, organisation_id, role, zerecruit_access")
            .eq("id", data.user.id)
            .single();

          if (
            profileError ||
            !profile.is_active ||
            !profile.zerecruit_access ||
            profile.organisation_id === null ||
            profile.role === "owner"
          ) {
            await supabase.auth.signOut();
            return NextResponse.redirect(`${url.origin}/auth/auth-code-error?reason=login-method`);
          }
        } else {
          await supabase.auth.signOut();
          return NextResponse.redirect(`${url.origin}/auth/auth-code-error?reason=login-method`);
        }

        const forwardedHost = request.headers.get("x-forwarded-host");
        const origin = process.env.NODE_ENV === "development" || !forwardedHost
          ? url.origin
          : `https://${forwardedHost}`;
        return NextResponse.redirect(`${origin}${next}`);
      } catch {
        return NextResponse.redirect(`${url.origin}/auth/auth-code-error?reason=profile`);
      }
    }
  }

  return NextResponse.redirect(`${url.origin}/auth/auth-code-error`);
}
