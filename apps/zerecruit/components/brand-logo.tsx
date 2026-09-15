import Link from "next/link";
import { ZeRecruitLogo } from "@ze/ui-foundations/brands";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return <ZeRecruitLogo compact={compact} />;
}

export function BrandLogo({ variant = "dark" }: { variant?: "dark" | "light" }) {
  return (
    <Link href="/" className={`brand-logo brand-logo-${variant}`} aria-label="ZeRecruit — Accueil">
      <ZeRecruitLogo inverse={variant === "light"} />
    </Link>
  );
}

export { ZeRecruitLogo };
