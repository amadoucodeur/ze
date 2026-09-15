import { describe, expect, it } from "vitest";
import {
  AUTH_EMAIL_SUFFIX,
  LOGIN_IDENTIFIER_PATTERN,
  ORGANISATION_IDENTIFIER_PATTERN,
  USER_IDENTIFIER_PATTERN,
  composeAuthEmail,
  composeLoginIdentifier,
  normalizeIdentifierPart,
} from "./identifiers";

describe("ZeRecruit Identifiers", () => {
  it("normalizes accent marks, whitespace, and special characters", () => {
    expect(normalizeIdentifierPart(" Amadou Cissé ")).toBe("amadou.cisse");
    expect(normalizeIdentifierPart("Équipe--RH")).toBe("equipe--rh");
    expect(normalizeIdentifierPart("...test_user---")).toBe("test_user");
  });

  it("truncates identifier part to 48 characters maximum", () => {
    const longString = "a".repeat(60);
    expect(normalizeIdentifierPart(longString).length).toBe(48);
  });

  it("composes login identifier as user@organisation in lowercase", () => {
    expect(composeLoginIdentifier("Amadou.Cisse", "Acme-Corp")).toBe(
      "amadou.cisse@acme-corp",
    );
  });

  it("composes technical auth email with .zerecruit.local suffix", () => {
    const login = "amadou.cisse@acme-corp";
    expect(composeAuthEmail(login)).toBe(`amadou.cisse@acme-corp${AUTH_EMAIL_SUFFIX}`);
  });

  it("validates patterns for user, organisation, and login", () => {
    expect(USER_IDENTIFIER_PATTERN.test("amadou.cisse")).toBe(true);
    expect(USER_IDENTIFIER_PATTERN.test("amadou_cisse")).toBe(true);
    expect(USER_IDENTIFIER_PATTERN.test("invalid..user")).toBe(false);

    expect(ORGANISATION_IDENTIFIER_PATTERN.test("acme-corp")).toBe(true);
    expect(ORGANISATION_IDENTIFIER_PATTERN.test("acme_corp")).toBe(false);

    expect(LOGIN_IDENTIFIER_PATTERN.test("amadou.cisse@acme-corp")).toBe(true);
    expect(LOGIN_IDENTIFIER_PATTERN.test("invalid-email")).toBe(false);
  });
});
