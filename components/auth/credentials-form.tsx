"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, LoaderCircle, UserRound } from "lucide-react";
import { useFormStatus } from "react-dom";
import { PasswordInput } from "@/components/auth/password-input";
import { googleSignupAction, loginAction, type AuthState } from "@/app/actions/auth";

const initialState: AuthState = {};

function GoogleButton() {
  const { pending } = useFormStatus();

  return (
    <button className="google-button unified-google-button" type="submit" disabled={pending}>
      {pending
        ? <><LoaderCircle className="spin" size={18} /> Redirection vers Google...</>
        : <><span className="google-g">G</span> Continuer avec Google <ArrowRight size={17} /></>}
    </button>
  );
}

export function UnifiedAuthForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <>
      <div className="auth-form-heading">
        <span>Connexion</span>
        <h2>Comment avez-vous obtenu votre accès&nbsp;?</h2>
        <p>Choisissez le chemin qui correspond à votre situation. Vous resterez sur cette même page.</p>
      </div>

      <section className="auth-choice-card auth-owner-choice" aria-labelledby="owner-access-title">
        <div className="auth-choice-heading"><span><Building2 size={18} /></span><div><small>Pour le propriétaire</small><h3 id="owner-access-title">Je gère mon organisation</h3><p>Vous avez créé ZeRecruit pour votre entreprise ou souhaitez créer son espace.</p></div></div>
        <form action={googleSignupAction} className="unified-google-form"><GoogleButton /></form>
      </section>

      <div className="auth-divider"><span>ou</span></div>

      <section className="auth-choice-card auth-team-choice" aria-labelledby="team-access-title">
        <div className="auth-choice-heading"><span><UserRound size={18} /></span><div><small>Pour les collaborateurs</small><h3 id="team-access-title">Mon organisation m’a donné un accès</h3><p>Utilisez l’identifiant et le mot de passe transmis par votre responsable.</p></div></div>
        <form action={formAction} className="auth-form">
        <div className="field-label">
          <label htmlFor="identifiant">Identifiant</label>
          <div className="input-wrap">
            <UserRound size={18} aria-hidden="true" />
            <input
              id="identifiant"
              name="identifiant"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Votre identifiant ZeRecruit"
              required
            />
          </div>
          {state.errors?.identifiant?.map((error) => <small className="field-error" key={error}>{error}</small>)}
        </div>
        <div className="field-label">
          <div className="label-row">
            <label htmlFor="password">Mot de passe</label>
            <Link href="/mot-de-passe-oublie">Mot de passe oublié ?</Link>
          </div>
          <PasswordInput id="password" name="password" autoComplete="current-password" placeholder="Votre mot de passe" />
          {state.errors?.password?.map((error) => <small className="field-error" key={error}>{error}</small>)}
        </div>
        {state.message && <div className="form-message form-error" role="alert">{state.message}</div>}
        <button className="button button-primary auth-submit" type="submit" disabled={pending}>
          {pending ? <><LoaderCircle className="spin" size={18} /> Connexion...</> : <>Se connecter <ArrowRight size={18} /></>}
        </button>
        </form>
      </section>
    </>
  );
}
