const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function getSupabaseConfig() {
  if (!supabaseUrl || supabaseUrl.includes("your_supabase_url")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL n’est pas configurée.");
  }

  if (!supabasePublishableKey) {
    throw new Error("La clé publique Supabase n’est pas configurée.");
  }

  return { supabaseUrl, supabasePublishableKey };
}
