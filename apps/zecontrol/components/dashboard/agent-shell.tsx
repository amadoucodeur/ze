import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { ZeControlLogo } from "@ze/ui-foundations/brands";
import { logoutAction } from "@/app/actions/auth";
import { DashboardNavLink } from "./dashboard-nav-link";

export function AgentShell({ children, fullname }: { children: React.ReactNode; fullname: string }) {
  return (
    <main className="agent-page">
      <header className="agent-header">
        <Link href="/dashboard" aria-label="ZeControl — Mon pointage"><ZeControlLogo /></Link>
        <nav aria-label="Compte utilisateur">
          <Link href="/dashboard/parametres/profil"><span>{fullname.slice(0, 2).toUpperCase()}</span><strong>{fullname}</strong><UserRound size={17} /></Link>
          <form action={logoutAction}><button type="submit" aria-label="Se déconnecter"><LogOut size={18} /></button></form>
        </nav>
      </header>
      <section className="agent-main">{children}</section>
      <nav className="agent-mobile-navigation" aria-label="Navigation principale">
        <DashboardNavLink href="/dashboard" label="Pointer" icon="clocking" match="exact" />
        <DashboardNavLink href="/dashboard/mon-activite" label="Activité" icon="reports" />
        <DashboardNavLink href="/dashboard/parametres/profil" label="Profil" icon="settings" />
      </nav>
    </main>
  );
}
