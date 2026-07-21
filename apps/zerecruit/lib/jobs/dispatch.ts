import "server-only";

import { after } from "next/server";
import { cleanupExpiredOperationalData } from "@/lib/jobs/maintenance";
import { processAiJobUntilSettled } from "@/lib/jobs/processor";

export function dispatchAiJobs(jobIds: string[]) {
  const uniqueJobIds = [...new Set(jobIds)].filter(Boolean);
  if (!uniqueJobIds.length) return;

  after(async () => {
    let cursor = 0;
    async function worker() {
      while (cursor < uniqueJobIds.length) {
        const jobId = uniqueJobIds[cursor];
        cursor += 1;
        await processAiJobUntilSettled(jobId);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(3, uniqueJobIds.length) }, () => worker()),
    );
    await cleanupExpiredOperationalData().catch(() => undefined);
  });
}
