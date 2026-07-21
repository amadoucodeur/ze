import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, Sparkles } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { PublicOfferSearch } from "@/components/careers/public-offer-search";
import { getPublicCareerDirectoryOffers } from "@/lib/careers/public";

export const metadata: Metadata = {
  title: "Offres d’emploi",
  description: "Découvrez les opportunités publiées par les entreprises qui recrutent avec ZeRecruit.",
};
export const revalidate = 60;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function value(params: Record<string, string | string[] | undefined>, key: string, maximum = 120) {
  const candidate = params[key];
  return typeof candidate === "string" ? candidate.trim().slice(0, maximum) : "";
}

export default async function PublicCareersPage({ searchParams }: { searchParams: SearchParams }) {
  const [offers, params] = await Promise.all([getPublicCareerDirectoryOffers(), searchParams]);

  return (
    <main className="career-page career-directory-page">
      <header className="career-header"><div className="career-container"><BrandLogo /><nav aria-label="Navigation carrière"><a href="#offres">Trouver une offre</a><Link href="/connexion">Espace recruteur <ArrowRight size={15} /></Link></nav></div></header>
      <section className="career-directory-hero">
        <div className="career-container">
          <span className="career-kicker"><Sparkles size={15} /> Des opportunités qui ont du sens</span>
          <h1>Trouvez le poste où votre talent fera la différence.</h1>
          <p>Explorez les offres ouvertes, trouvez celle qui vous ressemble et postulez simplement avec votre CV.</p>
          <div className="career-directory-proof"><span><BriefcaseBusiness size={17} /> {offers.length} offre{offers.length > 1 ? "s" : ""} publiée{offers.length > 1 ? "s" : ""}</span><span>Une candidature claire, sans compte à créer</span></div>
        </div>
      </section>
      <div className="career-container career-directory-content" id="offres">
        <PublicOfferSearch
          offers={offers}
          initialQuery={value(params, "q")}
          initialLocation={value(params, "lieu")}
          initialContract={value(params, "contrat", 30)}
          initialWorkMode={value(params, "mode", 30)}
        />
      </div>
      <footer className="career-footer"><div className="career-container"><span>Recrutement propulsé par <strong>ZeRecruit</strong></span><Link href="/">Découvrir ZeRecruit</Link></div></footer>
    </main>
  );
}
