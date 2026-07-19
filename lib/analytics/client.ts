"use client";

import { createClient } from "@/lib/supabase/client";

const allowedEvents = new Set([
  "talent_semantic_search_completed",
  "candidate_added_to_collection",
  "candidate_enrichment_completed",
  "cv_import_completed",
  "offer_created",
  "candidate_added_to_offer",
  "interview_guide_created",
  "interview_response_saved",
]);

export async function trackProductEvent(eventName: string, properties: Record<string, string | number | boolean | null>) {
  if (!allowedEvents.has(eventName)) return;
  const supabase = createClient();
  await supabase.from("product_events").insert({ event_name: eventName, properties });
}
