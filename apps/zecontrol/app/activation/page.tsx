import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Building2, CheckCircle2, ShieldAlert } from "lucide-react";
import { ZeControlLogo, ZeSuiteLogo } from "@ze/ui-foundations/brands";
import { logoutAction } from "@/app/actions/auth";
import { activateZeControlAction } from "@/app/actions/onboarding";
import { getCurrentZeControlAccess } from "@/lib/supabase/access";

export const dynamic = "force-dynamic";

const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL ?? "http://localhost:3002";

type ActivationPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function ActivationPage({
  searchParams,
}: ActivationPageProps) {
  const access = await getCurrentZeControlAccess();
  if (!access) redirect("/auth/clear-session");
  if (access.profile.must_change_password) redirect("/nouveau-mot-de-passe");
  if (access.status === "ready") redirect("/dashboard");
  if (
    access.status === "organisation-missing" &&
    access.profile.role === "owner"
  ) {
    redirect("/dashboard/organisation/nouvelle");
  }

  const { error } = await searchParams;

  const canRequestActivation =
    access.status === "product-inactive" && access.profile.role === "owner";

  return (
    <main className="access-page">
      <header className="access-header">
        <ZeControlLogo />
        <a href={portalUrl}><ZeSuiteLogo compact /> ZeSuite</a>
      </header>

      <section className="access-card">
        <span className="access-icon">
          {canRequestActivation ? <Building2 size={26} /> : <ShieldAlert size={26} />}
        </span>
        <p className="access-kicker">Compte ZeSuite reconnu</p>
        <h1>
          {canRequestActivation
            ? "ZeControl doit être activé pour votre organisation."
            : "Votre accès ZeControl n’est pas encore actif."}
        </h1>
        <p className="access-copy">
          {canRequestActivation
            ? `${access.organisation?.name ?? "Votre organisation"} existe déjà dans ZeSuite. L’étape suivante permettra de choisir et d’activer son accès ZeControl.`
            : "Votre identité est valide, mais votre organisation ne vous a pas encore donné accès à ce produit. Contactez son propriétaire ou un administrateur."}
        </p>

        <div className="access-identity">
          <CheckCircle2 size={18} />
          <div>
            <strong>{access.profile.fullname}</strong>
            <span>{access.profile.identifiant}</span>
          </div>
        </div>

        {error && (
          <div className="form-message form-error" role="alert">
            {error === "not-allowed"
              ? "Seul le propriétaire d’une organisation active peut activer ZeControl."
              : "L’activation n’a pas abouti. Aucun accès incomplet n’a été conservé. Réessayez."}
          </div>
        )}

        <div className="access-actions">
          {canRequestActivation ? (
            <form action={activateZeControlAction}>
              <button className="button button-primary" type="submit">
                Activer ZeControl <ArrowRight size={18} />
              </button>
            </form>
          ) : (
            <a className="button button-primary" href={portalUrl}>
              Retourner à ZeSuite <ArrowRight size={18} />
            </a>
          )}
          <form action={logoutAction}>
            <button className="button button-ghost" type="submit">Changer de compte</button>
          </form>
        </div>

        <Link className="access-home-link" href="/">Découvrir ZeControl</Link>
      </section>
    </main>
  );
}
