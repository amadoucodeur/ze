"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowLeft, ArrowRight, Building2, Check, LoaderCircle, UserRound } from "lucide-react";
import { useFormStatus } from "react-dom";
import {
  googleSignupAction,
  loginAction,
  type AuthState,
} from "@/app/actions/auth";
import { PasswordInput } from "./password-input";

const initialState: AuthState = {};

function GoogleButton() {
  const { pending } = useFormStatus();
  return (
    <button className="google-button" type="submit" disabled={pending}>
      {pending ? (
        <><LoaderCircle className="spin" size={18} /> Connexion à Google...</>
      ) : (
        <><span className="google-g">G</span> Continuer avec Google <ArrowRight size={17} /></>
      )}
    </button>
  );
}

export function UnifiedAuthForm() {
  const [path, setPath] = useState<"owner" | "member" | null>(null);
  const [state, formAction, pending] = useActionState(
    loginAction,
    initialState,
  );

  return (
    <>
      <div className="auth-form-heading">
        <span>Connexion</span>
        <h2>{path ? (path === "owner" ? "Accéder à mon organisation" : "Accéder à mon espace") : "Comment vous connectez-vous ?"}</h2>
        <p>{path
          ? (path === "owner"
            ? "Continuez avec Google. Votre espace sera retrouvé ou créé en quelques étapes."
            : "Utilisez l’identifiant transmis par votre organisation.")
          : "Choisissez simplement votre type d’accès. Nous afficherons uniquement les informations utiles."}</p>
      </div>

      {!path && <div className="auth-path-picker" role="group" aria-label="Type d’accès">
        <button type="button" onClick={() => setPath("owner")}>
          <span><Building2 size={21} /></span>
          <div>
            <small>Propriétaire</small>
            <strong>Je gère mon organisation</strong>
            <p>Connexion avec Google, création ou activation de ZeControl.</p>
          </div>
          <ArrowRight size={19} />
        </button>
        <button type="button" onClick={() => setPath("member")}>
          <span><UserRound size={21} /></span>
          <div>
            <small>Collaborateur</small>
            <strong>Mon organisation m’a donné un accès</strong>
            <p>Connexion avec un identifiant du type utilisateur@organisation.</p>
          </div>
          <ArrowRight size={19} />
        </button>
        <div className="auth-path-reassurance"><Check size={15} /> Un seul compte pour les produits ZeSuite activés.</div>
      </div>}

      {path === "owner" && <section className="auth-choice auth-choice-focused" aria-labelledby="owner-login-title">
        <div className="auth-choice-heading">
          <span><Building2 size={18} /></span>
          <div>
            <small>Accès propriétaire</small>
            <h3 id="owner-login-title">Continuer avec Google</h3>
            <p>Votre organisation existante sera reconnue. Sinon, vous pourrez la créer.</p>
          </div>
        </div>
        <form action={googleSignupAction}><GoogleButton /></form>
      </section>}

      {path === "member" && <section className="auth-choice auth-choice-focused" aria-labelledby="member-login-title">
        <form action={formAction} className="auth-form">
          <div className="auth-field">
            <label htmlFor="identifiant">Identifiant complet</label>
            <div className="auth-input-wrap">
              <UserRound size={18} aria-hidden="true" />
              <input
                id="identifiant"
                name="identifiant"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="amadou@trabad"
                required
              />
            </div>
            <small className="field-hint">Format : utilisateur@organisation</small>
            {state.errors?.identifiant?.map((error) => (
              <small className="field-error" key={error}>{error}</small>
            ))}
          </div>

          <div className="auth-field">
            <div className="label-row">
              <label htmlFor="password">Mot de passe</label>
              <Link href="/mot-de-passe-oublie">Mot de passe oublié ?</Link>
            </div>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              placeholder="Votre mot de passe"
            />
            {state.errors?.password?.map((error) => (
              <small className="field-error" key={error}>{error}</small>
            ))}
          </div>

          {state.message && (
            <div className="form-message form-error" role="alert">
              {state.message}
            </div>
          )}

          <button
            className="button button-primary auth-submit"
            type="submit"
            disabled={pending}
          >
            {pending ? (
              <><LoaderCircle className="spin" size={18} /> Connexion...</>
            ) : (
              <>Se connecter <ArrowRight size={18} /></>
            )}
          </button>
        </form>
      </section>}

      {path && <button className="auth-change-path" type="button" onClick={() => setPath(null)}>
        <ArrowLeft size={16} /> Choisir un autre type d’accès
      </button>}
    </>
  );
}
