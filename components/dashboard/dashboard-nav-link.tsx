"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, LayoutDashboard, Upload, UserRoundSearch, Users } from "lucide-react";

const icons = {
  home: LayoutDashboard,
  talents: UserRoundSearch,
  offers: BriefcaseBusiness,
  upload: Upload,
  team: Users,
};

type DashboardNavLinkProps = {
  href: string;
  label: string;
  icon: keyof typeof icons;
  match?: "exact" | "prefix" | "talent-list";
};

export function DashboardNavLink({ href, label, icon, match = "prefix" }: DashboardNavLinkProps) {
  const pathname = usePathname();
  const active = match === "exact"
    ? pathname === href
    : match === "talent-list"
      ? (pathname.startsWith("/dashboard/talents") && pathname !== "/dashboard/talents/nouveau") || pathname.startsWith("/dashboard/recherche") || pathname.startsWith("/dashboard/collections")
      : pathname.startsWith(href);
  const Icon = icons[icon];
  return <Link className={active ? "active" : ""} href={href}><Icon size={19} /> {label}</Link>;
}
