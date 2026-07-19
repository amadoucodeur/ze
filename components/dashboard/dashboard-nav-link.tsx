"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, BriefcaseBusiness, Building2, FolderHeart, LayoutDashboard, Search, Settings2, Upload, UserRound, UserRoundSearch, Users } from "lucide-react";

const icons = {
  home: LayoutDashboard,
  talents: UserRoundSearch,
  search: Search,
  assistant: Bot,
  collections: FolderHeart,
  offers: BriefcaseBusiness,
  upload: Upload,
  team: Users,
  profile: UserRound,
  settings: Settings2,
  building: Building2,
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
      ? pathname.startsWith("/dashboard/talents") && pathname !== "/dashboard/talents/nouveau"
      : pathname.startsWith(href);
  const Icon = icons[icon];
  return <Link className={active ? "active" : ""} href={href}><Icon size={19} /> {label}</Link>;
}
