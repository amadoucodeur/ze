export const USER_IDENTIFIER_PATTERN =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
export const LOGIN_IDENTIFIER_PATTERN =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*@[a-z0-9]+(?:-[a-z0-9]+)*$/;

const AUTH_EMAIL_SUFFIX = ".zerecruit.local";

/**
 * Les collaborateurs ZeSuite conservent l'adresse Auth technique historique.
 * Elle ne doit jamais être affichée comme adresse professionnelle.
 */
export function composeAuthEmail(loginIdentifier: string) {
  return `${loginIdentifier.toLowerCase()}${AUTH_EMAIL_SUFFIX}`;
}

export function composeLoginIdentifier(
  username: string,
  organisationIdentifier: string,
) {
  return `${username.toLowerCase()}@${organisationIdentifier.toLowerCase()}`;
}

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
