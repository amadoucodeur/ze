"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";

export function DashboardMobileMenu({ children }: { children: React.ReactNode }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const details = detailsRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        details.removeAttribute("open");
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !detailsRef.current?.open) return;
      detailsRef.current.removeAttribute("open");
      setOpen(false);
      summaryRef.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <details
      className="dashboard-mobile-menu"
      ref={detailsRef}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onClick={(event) => {
        if (!(event.target instanceof Element) || !event.target.closest("a")) return;
        detailsRef.current?.removeAttribute("open");
        setOpen(false);
      }}
    >
      <summary
        ref={summaryRef}
        aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
        aria-expanded={open}
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </summary>
      {children}
    </details>
  );
}
