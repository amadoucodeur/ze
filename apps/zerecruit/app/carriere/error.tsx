"use client";

import Link from "next/link";
import { AlertCircle, RotateCcw } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

export default function PublicCareersError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="career-page career-directory-page">
      <header className="career-header"><div className="career-container"><BrandLogo /></div></header>
      <div className="career-container career-directory-error">
        <div className="career-empty"><AlertCircle size={30} /><h1>Les offres ne sont pas disponibles.</h1><p>Le chargement a rencontré un problème temporaire.</p><div><button type="button" onClick={reset}><RotateCcw size={17} /> Réessayer</button><Link href="/">Retour à l’accueil</Link></div></div>
      </div>
    </main>
  );
}
