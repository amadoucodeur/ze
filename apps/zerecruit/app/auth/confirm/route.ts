import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type === "recovery") {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error && data.user) {
      try {
        const admin = createAdminClient();
        const { data: profile, error: profileError } = await admin
          .from("profiles")
          .select("is_active, organisation_id, role")
          .eq("id", data.user.id)
          .single();

        if (
          profileError ||
          !profile.is_active ||
          profile.organisation_id === null ||
          profile.role === "owner"
        ) {
          await supabase.auth.signOut();
          return NextResponse.redirect(new URL("/auth/auth-code-error?reason=login-method", request.url));
        }

        return NextResponse.redirect(new URL("/nouveau-mot-de-passe", request.url));
      } catch {
        return NextResponse.redirect(new URL("/auth/auth-code-error?reason=profile", request.url));
      }
    }
  }

  return NextResponse.redirect(new URL("/auth/auth-code-error", request.url));
}
