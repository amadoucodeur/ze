import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const response = NextResponse.redirect(new URL("/connexion", request.url));
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-")) response.cookies.delete(cookie.name);
  }
  return response;
}
