import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { BrandLogo } from "@/components/brand-logo";
import { DashboardMobileMenu } from "@/components/dashboard/dashboard-mobile-menu";
import { DashboardNavLink } from "@/components/dashboard/dashboard-nav-link";
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

function DashboardNavigation({
  role,
  organisationName,
  organisationHref,
}: {
  role: ProfileRole;
  organisationName: string | null;
  organisationHref: string;
}) {
  return (
    <>
      <DashboardNavLink href="/dashboard" label="Accueil" icon="home" match="exact" />
      {organisationName && <span className="dashboard-nav-label">Vivier</span>}
      {organisationName && <DashboardNavLink href="/dashboard/talents" label="Tous les profils" icon="talents" match="talent-list" />}
      {organisationName && <DashboardNavLink href="/dashboard/recherche" label="Rechercher" icon="search" />}
      {organisationName && <DashboardNavLink href="/dashboard/collections" label="Collections" icon="collections" />}
      {organisationName && role !== "viewer" && <DashboardNavLink href="/dashboard/talents/nouveau" label="Importer des CV" icon="upload" match="exact" />}
      {organisationName && <span className="dashboard-nav-label">Recrutement</span>}
      {organisationName && <DashboardNavLink href="/dashboard/offres" label="Offres" icon="offers" />}
      {(role === "owner" || role === "admin") && organisationName && <DashboardNavLink href="/dashboard/equipe" label="Équipe" icon="team" />}
      <span className="dashboard-nav-label">Compte</span>
      <DashboardNavLink href="/dashboard/parametres/profil" label="Mon profil" icon="profile" />
      {role === "owner" && <DashboardNavLink href={organisationHref} label={organisationName ? "Organisation" : "Créer l’entreprise"} icon={organisationName ? "settings" : "building"} />}
    </>
  );
}

function UserSummary({ fullname, role }: { fullname: string; role: ProfileRole }) {
  return <div className="sidebar-user"><span>{fullname.slice(0, 2).toUpperCase()}</span><div><strong>{fullname}</strong><small>{roleLabel(role)}</small></div></div>;
}

function LogoutForm() {
  return <form action={logoutAction}><button type="submit" aria-label="Se déconnecter"><LogOut size={18} /> <span>Se déconnecter</span></button></form>;
}

export function DashboardShell({ children, fullname, role, organisationName }: DashboardShellProps) {
  const organisationHref = organisationName
    ? "/dashboard/parametres/organisation"
    : "/dashboard/organisation/nouvelle";

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
          <DashboardNavigation role={role} organisationName={organisationName} organisationHref={organisationHref} />
        </nav>
        <div className="dashboard-sidebar-footer">
          <UserSummary fullname={fullname} role={role} />
          <LogoutForm />
        </div>
      </aside>
      <header className="dashboard-mobile-header">
        <BrandLogo variant="light" />
        <div className="dashboard-mobile-workspace"><small>Espace</small><strong>{organisationName ?? "À configurer"}</strong></div>
        <DashboardMobileMenu>
          <div className="dashboard-mobile-drawer">
            <div className="dashboard-mobile-user"><UserSummary fullname={fullname} role={role} /></div>
            <nav aria-label="Navigation mobile du tableau de bord"><DashboardNavigation role={role} organisationName={organisationName} organisationHref={organisationHref} /></nav>
            <div className="dashboard-mobile-logout"><LogoutForm /></div>
          </div>
        </DashboardMobileMenu>
      </header>
      <section className="dashboard-main" id="dashboard-content" tabIndex={-1}>{children}</section>
    </main>
  );
}
