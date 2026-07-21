import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export async function cleanupExpiredOperationalData() {
  const admin = createAdminClient();
  const completedBefore = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const failedBefore = new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000).toISOString();
  const searchesBefore = new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000).toISOString();
  const eventsBefore = new Date(Date.now() - 180 * 24 * 60 * 60 * 1_000).toISOString();

  await Promise.all([
    admin.from("ai_processing_jobs").delete().in("status", ["completed", "cancelled"]).lt("completed_at", completedBefore),
    admin.from("ai_processing_jobs").delete().eq("status", "failed").lt("completed_at", failedBefore),
    admin.from("talent_search_sessions").delete().lt("created_at", searchesBefore),
    admin.from("product_events").delete().lt("created_at", eventsBefore),
  ]);
}
