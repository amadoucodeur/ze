"use client";

import { useEffect } from "react";

export function JobRecovery() {
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/talents/import/jobs?recover=1", {
      cache: "no-store",
      signal: controller.signal,
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  return null;
}
