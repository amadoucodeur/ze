import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BriefcaseBusiness, Check, MapPin } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { PublicApplicationForm } from "@/components/careers/public-application-form";
import { getPublicCareerOffer, getPublicCareerOrganisation } from "@/lib/careers/public";

export const revalidate = 60;

const workModes: Record<string, string> = { onsite: "Sur site", hybrid: "Hybride", remote: "À distance" };
const contractTypes: Record<string, string> = { permanent: "CDI", fixed_term: "CDD", internship: "Stage", freelance: "Freelance", temporary: "Intérim", apprenticeship: "Alternance", other: "Autre" };

async function load(identifier: string, slug: string) {
  const organisation = await getPublicCareerOrganisation(identifier);
  if (!organisation) return null;
  const offer = await getPublicCareerOffer(organisation.id, slug);
  return offer ? { organisation, offer } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ organisation: string; slug: string }> }): Promise<Metadata> {
  const values = await params;
  const result = await load(values.organisation, values.slug);
  if (!result) return { title: "Offre" };
  return { title: `${result.offer.title} — ${result.organisation.name}`, description: result.offer.summary || result.offer.mission || `Postulez chez ${result.organisation.name}.` };
}

export default async function CareerOfferPage({ params }: { params: Promise<{ organisation: string; slug: string }> }) {
  const values = await params;
  const result = await load(values.organisation, values.slug);
  if (!result) notFound();
  const { organisation, offer } = result;

  return <main className="career-page career-offer-page">
    <header className="career-header"><div className="career-container"><BrandLogo /><nav aria-label="Navigation carrière"><span>Opportunités chez {organisation.name}</span><Link href="/carriere">Toutes les offres</Link></nav></div></header>
    <section className="career-offer-hero"><div className="career-container"><Link className="career-back" href={`/carriere/${organisation.identifiant}`}><ArrowLeft size={17} /> Toutes les opportunités</Link><span>{offer.department || organisation.name}</span><h1>{offer.title}</h1><div>{offer.contract_type && <small><BriefcaseBusiness size={15} />{contractTypes[offer.contract_type] || offer.contract_type}</small>}{offer.location && <small><MapPin size={15} />{offer.location}</small>}{offer.work_mode && <small>{workModes[offer.work_mode] || offer.work_mode}</small>}</div></div></section>
    <div className="career-container career-offer-layout"><article className="career-offer-copy">
      <section><span>Le rôle</span><h2>Votre mission</h2><p>{offer.mission || offer.summary || "La mission sera précisée lors du premier échange."}</p></section>
      {offer.responsibilities.length > 0 && <section><h2>Ce que vous ferez</h2><ul>{offer.responsibilities.map((item) => <li key={item}><Check size={17} />{item}</li>)}</ul></section>}
      {offer.success_outcomes.length > 0 && <section><h2>Ce que nous réussirons ensemble</h2><ul>{offer.success_outcomes.map((item) => <li key={item}><Check size={17} />{item}</li>)}</ul></section>}
      {(offer.must_have_skills.length > 0 || offer.nice_to_have_skills.length > 0) && <section><h2>Ce qui vous aidera à réussir</h2><div className="career-skills">{offer.must_have_skills.map((skill) => <span className="is-primary" key={skill}>{skill}</span>)}{offer.nice_to_have_skills.map((skill) => <span key={skill}>{skill}</span>)}</div></section>}
    </article><aside><PublicApplicationForm organisation={organisation.identifiant} offerSlug={offer.public_slug} /></aside></div>
    <footer className="career-footer"><div className="career-container"><span>Recrutement propulsé par <strong>ZeRecruit</strong></span><Link href="/">Découvrir ZeRecruit</Link></div></footer>
  </main>;
}
