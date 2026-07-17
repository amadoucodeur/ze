"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, LayoutDashboard, LogOut, Menu, Settings2, UserRound, UserRoundSearch, Users } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { BrandLogo } from "@/components/brand-logo";
import type { ProfileRole } from "@/lib/supabase/current-profile";

type DashboardShellProps = {
  children: React.ReactNode;
  fullname: string;
  role: ProfileRole;
  organisationName: string | null;
};

function roleLabel(role: ProfileRole) {
  return { owner: "Propriétaire", admin: "Administrateur", recruiter: "Recruteur", viewer: "Lecteur" }[role];
}

export function DashboardShell({ children, fullname, role, organisationName }: DashboardShellProps) {
  const pathname = usePathname();
  const organisationHref = organisationName
    ? "/dashboard/parametres/organisation"
    : "/dashboard/organisation/nouvelle";

  const isActive = (href: string) => href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  const navigation = (
    <>
      <Link className={isActive("/dashboard") ? "active" : ""} href="/dashboard"><LayoutDashboard size={19} /> Accueil</Link>
      {organisationName && <Link className={isActive("/dashboard/talents") ? "active" : ""} href="/dashboard/talents"><UserRoundSearch size={19} /> Talents</Link>}
      {role === "owner" && organisationName && <Link className={isActive("/dashboard/equipe") ? "active" : ""} href="/dashboard/equipe"><Users size={19} /> Équipe</Link>}
      <span className="dashboard-nav-label">Compte</span>
      <Link className={isActive("/dashboard/parametres/profil") ? "active" : ""} href="/dashboard/parametres/profil"><UserRound size={19} /> Mon profil</Link>
      {role === "owner" && <Link className={isActive(organisationHref) ? "active" : ""} href={organisationHref}>{organisationName ? <Settings2 size={19} /> : <Building2 size={19} />}{organisationName ? "Organisation" : "Créer l’entreprise"}</Link>}
    </>
  );

  const userSummary = (
    <div className="sidebar-user"><span>{fullname.slice(0, 2).toUpperCase()}</span><div><strong>{fullname}</strong><small>{roleLabel(role)}</small></div></div>
  );

  const logout = (
    <form action={logoutAction}><button type="submit" aria-label="Se déconnecter"><LogOut size={18} /> <span>Se déconnecter</span></button></form>
  );

  return (
    <main className="dashboard-page">
      <a className="skip-link" href="#dashboard-content">Aller au contenu</a>
      <aside className="dashboard-sidebar">
        <BrandLogo variant="light" />
        <div className="dashboard-workspace">
          <span className="workspace-mark">{organisationName?.slice(0, 1).toUpperCase() ?? "Z"}</span>
          <div><small>Espace de travail</small><strong>{organisationName ?? "À configurer"}</strong></div>
        </div>
        <nav aria-label="Navigation du tableau de bord">
          {navigation}
        </nav>
        <div className="dashboard-sidebar-footer">
          {userSummary}
          {logout}
        </div>
      </aside>
      <header className="dashboard-mobile-header">
        <BrandLogo variant="light" />
        <div className="dashboard-mobile-workspace"><small>Espace</small><strong>{organisationName ?? "À configurer"}</strong></div>
        <details className="dashboard-mobile-menu">
          <summary aria-label="Ouvrir le menu"><Menu size={22} /></summary>
          <div className="dashboard-mobile-drawer">
            <div className="dashboard-mobile-user">{userSummary}</div>
            <nav aria-label="Navigation mobile du tableau de bord">{navigation}</nav>
            <div className="dashboard-mobile-logout">{logout}</div>
          </div>
        </details>
      </header>
      <section className="dashboard-main" id="dashboard-content" tabIndex={-1}>{children}</section>
    </main>
  );
}
