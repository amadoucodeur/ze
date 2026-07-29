"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ZeControlRole } from "@/lib/supabase/access";

export function AccessRoleSynchronizer({
  profileId,
  role,
}: {
  profileId: string;
  role: ZeControlRole;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const refreshingRef = useRef(false);

  useEffect(() => {
    let active = true;

    async function synchronizeRole() {
      const { data, error } = await supabase
        .schema("zecontrol")
        .from("profiles_configs")
        .select("role")
        .eq("id", profileId)
        .maybeSingle();

      if (
        !active ||
        error ||
        !data ||
        data.role === role ||
        refreshingRef.current
      ) {
        return;
      }

      refreshingRef.current = true;
      router.refresh();
    }

    function synchronizeWhenVisible() {
      if (document.visibilityState === "visible") void synchronizeRole();
    }

    void synchronizeRole();
    window.addEventListener("focus", synchronizeWhenVisible);
    document.addEventListener("visibilitychange", synchronizeWhenVisible);

    return () => {
      active = false;
      window.removeEventListener("focus", synchronizeWhenVisible);
      document.removeEventListener("visibilitychange", synchronizeWhenVisible);
    };
  }, [profileId, role, router, supabase]);

  return null;
}
