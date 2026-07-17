"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

export default function DashboardError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <main className="simple-state-page">
      <BrandLogo />
      <section className="state-card" aria-labelledby="dashboard-error-title">
        <span><AlertTriangle size={24} /></span>
        <h1 id="dashboard-error-title">Votre espace n’a pas pu se charger.</h1>
        <p>Vos données n’ont pas été modifiées. Vérifiez votre connexion puis relancez l’affichage.</p>
        <button className="button button-primary" type="button" onClick={() => unstable_retry()}><RotateCcw size={18} /> Réessayer</button>
      </section>
    </main>
  );
}
