import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

export default function NotFound() {
  return (
    <main className="simple-state-page">
      <BrandLogo />
      <section className="state-card" aria-labelledby="not-found-title">
        <span><SearchX size={24} /></span>
        <h1 id="not-found-title">Cette page n’existe pas.</h1>
        <p>Le lien est peut-être ancien ou incorrect. Revenez à l’accueil pour continuer.</p>
        <Link className="button button-primary" href="/"><ArrowLeft size={18} /> Revenir à l’accueil</Link>
      </section>
    </main>
  );
}
