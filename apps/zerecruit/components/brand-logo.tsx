import Link from "next/link";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`logo-symbol${compact ? " logo-symbol-compact" : ""}`} aria-hidden="true">
      <span className="logo-layer logo-layer-one" />
      <span className="logo-layer logo-layer-two" />
      <span className="logo-face"><b>Z</b></span>
    </span>
  );
}

export function BrandLogo({ variant = "dark" }: { variant?: "dark" | "light" }) {
  return (
    <Link href="/" className={`brand-logo brand-logo-${variant}`} aria-label="ZeRecruit — Accueil">
      <BrandMark />
      <span className="logo-word"><b>Ze</b><span>Recruit</span></span>
    </Link>
  );
}
