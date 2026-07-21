import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BriefcaseBusiness, Building2, MapPin } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { getPublicCareerOrganisation, getPublicCareerOffers } from "@/lib/careers/public";

export const revalidate = 60;

const workModes: Record<string, string> = { onsite: "Sur site", hybrid: "Hybride", remote: "À distance" };
const contractTypes: Record<string, string> = { permanent: "CDI", fixed_term: "CDD", internship: "Stage", freelance: "Freelance", temporary: "Intérim", apprenticeship: "Alternance", other: "Autre" };

export async function generateMetadata({ params }: { params: Promise<{ organisation: string }> }): Promise<Metadata> {
  const { organisation: identifier } = await params;
  const organisation = await getPublicCareerOrganisation(identifier);
  if (!organisation) return { title: "Opportunités" };
  return { title: `Carrières chez ${organisation.name}`, description: `Découvrez les opportunités ouvertes chez ${organisation.name}.` };
}

export default async function CareerPage({ params }: { params: Promise<{ organisation: string }> }) {
  const { organisation: identifier } = await params;
  const organisation = await getPublicCareerOrganisation(identifier);
  if (!organisation) notFound();
  const offers = await getPublicCareerOffers(organisation.id);

  return <main className="career-page">
    <header className="career-header"><div className="career-container"><BrandLogo /><nav aria-label="Navigation carrière"><span>Opportunités chez {organisation.name}</span><Link href="/carriere">Toutes les offres</Link></nav></div></header>
    <section className="career-hero"><div className="career-container"><div className="career-company-mark"><Building2 size={28} /></div><span className="career-kicker">Rejoignez-nous</span><h1>Construisez la suite avec <em>{organisation.name}</em>.</h1><p>{organisation.description || "Découvrez les missions ouvertes et trouvez celle où votre expérience pourra vraiment faire la différence."}</p></div></section>
    <section className="career-openings"><div className="career-container"><div className="career-section-heading"><div><span>Postes ouverts</span><h2>{offers.length ? `${offers.length} opportunité${offers.length > 1 ? "s" : ""} à découvrir` : "Aucune opportunité ouverte"}</h2></div><p>Chaque candidature est étudiée par l’équipe de recrutement.</p></div>
      {offers.length ? <div className="career-offer-list">{offers.map((offer) => <Link href={`/carriere/${identifier}/${offer.public_slug}`} className="career-offer-card" key={offer.id}><div><span>{offer.department || "Équipe"}</span><h3>{offer.title}</h3><p>{offer.summary || offer.mission || "Découvrez le rôle et les responsabilités."}</p><div>{offer.contract_type && <small><BriefcaseBusiness size={14} />{contractTypes[offer.contract_type] || offer.contract_type}</small>}{offer.location && <small><MapPin size={14} />{offer.location}</small>}{offer.work_mode && <small>{workModes[offer.work_mode] || offer.work_mode}</small>}</div></div><span className="career-offer-arrow"><ArrowRight size={20} /></span></Link>)}</div> : <div className="career-empty"><BriefcaseBusiness size={28} /><h3>Revenez bientôt.</h3><p>L’équipe n’a pas de poste publié pour le moment.</p></div>}
    </div></section>
    <footer className="career-footer"><div className="career-container"><span>Recrutement propulsé par <strong>ZeRecruit</strong></span><Link href="/">Découvrir ZeRecruit</Link></div></footer>
  </main>;
}
