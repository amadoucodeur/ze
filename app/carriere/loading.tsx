import { BrandLogo } from "@/components/brand-logo";

export default function PublicCareersLoading() {
  return (
    <main className="career-page career-directory-page" aria-busy="true">
      <header className="career-header"><div className="career-container"><BrandLogo /></div></header>
      <section className="career-directory-hero"><div className="career-container career-directory-loading-hero"><span /><span /><span /></div></section>
      <div className="career-container career-directory-content"><div className="public-job-search-form career-directory-loading-search" /><div className="career-directory-loading-results"><span /><span /><span /></div></div>
      <span className="sr-only">Chargement des offres…</span>
    </main>
  );
}
