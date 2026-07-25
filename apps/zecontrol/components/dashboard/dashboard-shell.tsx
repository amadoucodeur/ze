import Link from "next/link";
import { AppWindow, LogOut } from "lucide-react";
import { ZeControlLogo } from "@ze/ui-foundations/brands";
import { logoutAction } from "@/app/actions/auth";
import { DashboardMobileMenu } from "./dashboard-mobile-menu";
import { DashboardNavLink } from "./dashboard-nav-link";
import type { ZeControlRole } from "@/lib/supabase/access";

type DashboardShellProps = {
  children: React.ReactNode;
  fullname: string;
  role: ZeControlRole;
  organisationName: string | null;
  canManageTeam: boolean;
  pendingRequestCount: number;
};

const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL ?? "http://localhost:3002";

function roleLabel(role: ZeControlRole) {
  return {
    owner: "Propriétaire",
    admin: "Administrateur",
    agent: "Agent",
  }[role];
}

function DashboardNavigation({
  organisationName,
  canManageTeam,
  pendingRequestCount,
  role,
}: {
  organisationName: string | null;
  canManageTeam: boolean;
  pendingRequestCount: number;
  role: ZeControlRole;
}) {
  return (
    <>
      <DashboardNavLink href="/dashboard" label="Accueil" icon="home" match="exact" />
      {organisationName && canManageTeam && (
        <DashboardNavLink href="/dashboard/pointage" label="Pointage" icon="clocking" />
      )}
      {organisationName && canManageTeam && (
        <DashboardNavLink href="/dashboard/rapports" label="Rapports" icon="reports" />
      )}
      {organisationName && canManageTeam && (
        <DashboardNavLink href="/dashboard/demandes" label="Demandes" icon="requests" badge={pendingRequestCount} />
      )}
      {organisationName && canManageTeam && (
        <DashboardNavLink href="/dashboard/equipe" label="Équipe" icon="team" />
      )}
      <DashboardNavLink href={role === "owner" ? "/dashboard/parametres/organisation" : "/dashboard/parametres/profil"} label="Paramètres" icon="settings" />
    </>
  );
}

function UserSummary({ fullname, role }: { fullname: string; role: ZeControlRole }) {
  return (
    <Link className="sidebar-user" href="/dashboard/parametres/profil" aria-label="Ouvrir mon profil">
      <span>{fullname.slice(0, 2).toUpperCase()}</span>
      <div>
        <strong>{fullname}</strong>
        <small>{roleLabel(role)} · Mon profil</small>
      </div>
    </Link>
  );
}

function LogoutForm() {
  return (
    <form action={logoutAction}>
      <button type="submit" aria-label="Se déconnecter">
        <LogOut size={18} /> <span>Se déconnecter</span>
      </button>
    </form>
  );
}

export function DashboardShell({
  children,
  fullname,
  role,
  organisationName,
  canManageTeam,
  pendingRequestCount,
}: DashboardShellProps) {
  return (
    <main className="dashboard-page">
      <a className="skip-link" href="#dashboard-content">Aller au contenu</a>
      <aside className="dashboard-sidebar">
        <Link href="/dashboard" className="dashboard-brand" aria-label="ZeControl — Accueil">
          <ZeControlLogo inverse />
        </Link>
        {role === "owner" && organisationName ? <Link className="dashboard-workspace" href="/dashboard/parametres/organisation" aria-label="Paramètres de l’organisation">
          <span className="workspace-mark">{organisationName?.slice(0, 1).toUpperCase() ?? "Z"}</span>
          <div>
            <small>Espace de travail</small>
            <strong>{organisationName ?? "À configurer"}</strong>
          </div>
        </Link> : <div className="dashboard-workspace">
          <span className="workspace-mark">{organisationName?.slice(0, 1).toUpperCase() ?? "Z"}</span>
          <div><small>Espace de travail</small><strong>{organisationName ?? "À configurer"}</strong></div>
        </div>}
        <nav aria-label="Navigation du tableau de bord">
          <DashboardNavigation organisationName={organisationName} canManageTeam={canManageTeam} pendingRequestCount={pendingRequestCount} role={role} />
        </nav>
        <div className="dashboard-sidebar-footer">
          <UserSummary fullname={fullname} role={role} />
          <a className="dashboard-apps-link" href={portalUrl}>
            <AppWindow size={18} /> <span>Mes applications</span>
          </a>
          <LogoutForm />
        </div>
      </aside>
      <header className="dashboard-mobile-header">
        <Link href="/dashboard" className="dashboard-brand" aria-label="ZeControl — Accueil">
          <ZeControlLogo inverse />
        </Link>
        <div className="dashboard-mobile-workspace">
          <small>Espace</small>
          <strong>{organisationName ?? "À configurer"}</strong>
        </div>
        <DashboardMobileMenu>
          <div className="dashboard-mobile-drawer">
            <div className="dashboard-mobile-user"><UserSummary fullname={fullname} role={role} /></div>
            <nav aria-label="Navigation mobile du tableau de bord">
              <DashboardNavigation organisationName={organisationName} canManageTeam={canManageTeam} pendingRequestCount={pendingRequestCount} role={role} />
            </nav>
            <div className="dashboard-mobile-apps">
              <a href={portalUrl}><AppWindow size={18} /> Mes applications</a>
            </div>
            <div className="dashboard-mobile-logout"><LogoutForm /></div>
          </div>
        </DashboardMobileMenu>
      </header>
      <section className="dashboard-main" id="dashboard-content" tabIndex={-1}>
        {children}
      </section>
    </main>
  );
}
