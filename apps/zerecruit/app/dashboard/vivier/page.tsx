import { redirect } from "next/navigation";

type LegacySearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LegacyTalentSearchPage({ searchParams }: { searchParams: LegacySearchParams }) {
  const params = await searchParams;
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.trim()) next.set(key, value);
  }

  const query = next.toString();
  redirect(query ? `/dashboard/recherche?${query}` : "/dashboard/recherche");
}
