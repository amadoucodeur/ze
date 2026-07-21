export const USER_IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
export const ORGANISATION_IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const LOGIN_IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*@[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const AUTH_EMAIL_SUFFIX = ".zerecruit.local";

export function normalizeIdentifierPart(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[^a-z0-9._-]+/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 48);
}

export function composeLoginIdentifier(userIdentifier: string, organisationIdentifier: string) {
  return `${userIdentifier.toLowerCase()}@${organisationIdentifier.toLowerCase()}`;
}

/**
 * Adresse technique utilisée uniquement par Supabase Auth.
 * Exemple : amadou@boss-co devient amadou@boss-co.zerecruit.local.
 */
export function composeAuthEmail(loginIdentifier: string) {
  return `${loginIdentifier.toLowerCase()}${AUTH_EMAIL_SUFFIX}`;
}
