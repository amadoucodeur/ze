"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BellRing, Clock3, LayoutDashboard, Settings2, UsersRound } from "lucide-react";

const icons = {
  home: LayoutDashboard,
  clocking: Clock3,
  team: UsersRound,
  reports: BarChart3,
  requests: BellRing,
  settings: Settings2,
};

type DashboardNavLinkProps = {
  href: string;
  label: string;
  icon: keyof typeof icons;
  match?: "exact" | "prefix";
  badge?: number;
};

export function DashboardNavLink({
  href,
  label,
  icon,
  match = "prefix",
  badge,
}: DashboardNavLinkProps) {
  const pathname = usePathname();
  const active = match === "exact" ? pathname === href : pathname.startsWith(href);
  const Icon = icons[icon];

  return (
    <Link className={active ? "active" : ""} href={href}>
      <Icon size={19} /> {label} {Boolean(badge) && <span className="dashboard-nav-badge">{badge! > 99 ? "99+" : badge}</span>}
    </Link>
  );
}
