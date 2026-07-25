import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { getZeControlAccess } from "@/lib/supabase/access";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type === "recovery") {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error && data.user) {
      const access = await getZeControlAccess(data.user.id);
      if (
        access?.profile.is_active &&
        access.profile.organisation_id &&
        access.profile.role !== "owner"
      ) {
        return NextResponse.redirect(
          new URL("/nouveau-mot-de-passe", request.url),
        );
      }

      await supabase.auth.signOut();
      return NextResponse.redirect(
        new URL("/auth/auth-code-error?reason=login-method", request.url),
      );
    }
  }

  return NextResponse.redirect(
    new URL("/auth/auth-code-error", request.url),
  );
}
