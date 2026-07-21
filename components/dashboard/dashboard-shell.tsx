import { LogOut } from "lucide-react";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { BrandLogo } from "@/components/brand-logo";
import { DashboardMobileMenu } from "@/components/dashboard/dashboard-mobile-menu";
import { DashboardNavLink } from "@/components/dashboard/dashboard-nav-link";
import { JobRecovery } from "@/components/dashboard/job-recovery";
import type { ProfileRole } from "@/lib/supabase/current-profile";

type DashboardShellProps = {
  children: React.ReactNode;
  fullname: string;
  role: ProfileRole;
  organisationName: string | null;
  planName: string;
  planAccessActive: boolean;
  teamManagementEnabled: boolean;
};

function roleLabel(role: ProfileRole) {
  return { owner: "Propriétaire", admin: "Administrateur", recruiter: "Recruteur", viewer: "Lecteur" }[role];
}

function DashboardNavigation({
  role,
  organisationName,
  teamManagementEnabled,
}: {
  role: ProfileRole;
  organisationName: string | null;
  teamManagementEnabled: boolean;
}) {
  return (
    <>
      <DashboardNavLink href="/dashboard" label="Accueil" icon="home" match="exact" />
      {organisationName && <DashboardNavLink href="/dashboard/offres" label="Offres" icon="offers" />}
      {organisationName && <DashboardNavLink href="/dashboard/talents" label="Vivier" icon="talents" match="talent-list" />}
      {organisationName && role !== "viewer" && <DashboardNavLink href="/dashboard/talents/nouveau" label="Importer" icon="upload" match="exact" />}
      {(role === "owner" || role === "admin") && organisationName && teamManagementEnabled && <DashboardNavLink href="/dashboard/equipe" label="Équipe" icon="team" />}
    </>
  );
}

function UserSummary({ fullname, role }: { fullname: string; role: ProfileRole }) {
  return <Link className="sidebar-user" href="/dashboard/parametres/profil" aria-label="Ouvrir mon profil"><span>{fullname.slice(0, 2).toUpperCase()}</span><div><strong>{fullname}</strong><small>{roleLabel(role)} · Mon profil</small></div></Link>;
}

function LogoutForm() {
  return <form action={logoutAction}><button type="submit" aria-label="Se déconnecter"><LogOut size={18} /> <span>Se déconnecter</span></button></form>;
}

export function DashboardShell({ children, fullname, role, organisationName, planName, planAccessActive, teamManagementEnabled }: DashboardShellProps) {
  const organisationHref = organisationName
    ? "/dashboard/parametres/organisation"
    : "/dashboard/organisation/nouvelle";

  return (
    <main className="dashboard-page">
      {organisationName && planAccessActive && role !== "viewer" && <JobRecovery />}
      <a className="skip-link" href="#dashboard-content">Aller au contenu</a>
      <aside className="dashboard-sidebar">
        <BrandLogo variant="light" />
        {role === "owner" ? <Link className="dashboard-workspace" href={organisationHref} aria-label={organisationName ? "Paramètres de l’organisation" : "Créer l’entreprise"}>
          <span className="workspace-mark">{organisationName?.slice(0, 1).toUpperCase() ?? "Z"}</span>
          <div><small>Espace de travail</small><strong>{organisationName ?? "À configurer"}</strong></div>
        </Link> : <div className="dashboard-workspace"><span className="workspace-mark">{organisationName?.slice(0, 1).toUpperCase() ?? "Z"}</span><div><small>Espace de travail</small><strong>{organisationName ?? "À configurer"}</strong></div></div>}
        <nav aria-label="Navigation du tableau de bord">
          <DashboardNavigation role={role} organisationName={organisationName} teamManagementEnabled={teamManagementEnabled} />
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
            <nav aria-label="Navigation mobile du tableau de bord"><DashboardNavigation role={role} organisationName={organisationName} teamManagementEnabled={teamManagementEnabled} /></nav>
            <div className="dashboard-mobile-logout"><LogoutForm /></div>
          </div>
        </DashboardMobileMenu>
      </header>
      <section className="dashboard-main" id="dashboard-content" tabIndex={-1}>
        {organisationName && !planAccessActive && <div className="dashboard-plan-alert" role="status"><div><strong>Votre accès {planName} est arrivé à échéance.</strong><span>Vos données restent accessibles, mais les nouvelles opérations sont suspendues.</span></div>{role === "owner" ? <Link href="/dashboard/abonnement">Renouveler le plan</Link> : <span>Contactez le propriétaire.</span>}</div>}
        {children}
      </section>
    </main>
  );
}
