import { BrandLogo } from "@/components/brand-logo";

export default function DashboardLoading() {
  return (
    <main className="dashboard-loading" aria-busy="true" aria-label="Chargement de votre espace">
      <BrandLogo />
      <div className="dashboard-loading-card"><span /><span /><span /></div>
      <p>Préparation de votre espace…</p>
    </main>
  );
}
