"use client";

import { useState, useActionState } from "react";
import { ArrowRight, AtSign, Building2, LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";
import {
  createOrganisationAction,
  type OnboardingState,
} from "@/app/actions/onboarding";

const initialState: OnboardingState = {};

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button button-primary onboarding-submit" type="submit" disabled={pending}>
      {pending ? (
        <><LoaderCircle className="spin" size={18} /> Création...</>
      ) : (
        <>Créer mon espace ZeControl <ArrowRight size={18} /></>
      )}
    </button>
  );
}

export function OrganisationForm() {
  const [state, action] = useActionState(createOrganisationAction, initialState);
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [identifierEdited, setIdentifierEdited] = useState(false);

  return (
    <form action={action} className="onboarding-form">
      <div className="auth-field">
        <label htmlFor="name">Nom de l’organisation</label>
        <div className="auth-input-wrap">
          <Building2 size={18} aria-hidden="true" />
          <input
            id="name"
            name="name"
            value={name}
            onChange={(event) => {
              const nextName = event.target.value;
              setName(nextName);
              if (!identifierEdited) setIdentifier(slugify(nextName));
            }}
            placeholder="Exemple : Horizon Conseil"
            maxLength={100}
            autoComplete="organization"
            required
          />
        </div>
        {state.errors?.name?.map((error) => (
          <small className="field-error" key={error}>{error}</small>
        ))}
      </div>

      <div className="auth-field">
        <label htmlFor="identifiant">Identifiant de l’organisation</label>
        <div className="auth-input-wrap">
          <AtSign size={18} aria-hidden="true" />
          <input
            id="identifiant"
            name="identifiant"
            value={identifier}
            onChange={(event) => {
              setIdentifierEdited(true);
              setIdentifier(slugify(event.target.value));
            }}
            placeholder="horizon-conseil"
            maxLength={40}
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </div>
        <small className="field-hint">
          Il formera les accès de l’équipe, par exemple admin@{identifier || "horizon-conseil"}.
        </small>
        {state.errors?.identifiant?.map((error) => (
          <small className="field-error" key={error}>{error}</small>
        ))}
      </div>

      {state.message && (
        <div className="form-message form-error" role="alert">{state.message}</div>
      )}

      <SubmitButton />
    </form>
  );
}
