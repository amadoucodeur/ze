import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateSession } from "./proxy";

let signedIn = false;

vi.mock("./config", () => ({
  getSupabaseConfig: () => ({
    supabaseUrl: "https://example.supabase.co",
    supabasePublishableKey: "key",
  }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({
        data: signedIn ? { claims: { sub: "user" } } : null,
      }),
    },
  }),
}));

const ANDROID = "Mozilla/5.0 (Linux; Android 15; wv) Chrome/130 ZeControlAndroid/1.0.3";
const BROWSER = "Mozilla/5.0 (Linux; Android 15) Chrome/130 Mobile";

function visit(path: string, userAgent: string) {
  return updateSession(
    new NextRequest(`https://zecontrol.test${path}`, {
      headers: { "user-agent": userAgent },
    }),
  );
}

describe("landing page in the Android app", () => {
  beforeEach(() => {
    signedIn = false;
  });

  it("sends a signed-out app user to the login page", async () => {
    const response = await visit("/", ANDROID);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://zecontrol.test/connexion");
  });

  it("sends a signed-in app user to the dashboard", async () => {
    signedIn = true;
    const response = await visit("/", ANDROID);
    expect(response.headers.get("location")).toBe("https://zecontrol.test/dashboard");
  });

  it("drops the router's internal query when redirecting", async () => {
    const response = await visit("/?_rsc=abc", ANDROID);
    expect(response.headers.get("location")).toBe("https://zecontrol.test/connexion");
  });

  it("still shows the landing page in a browser", async () => {
    const response = await visit("/", BROWSER);
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("leaves other public pages available in the app", async () => {
    const response = await visit("/connexion", ANDROID);
    expect(response.headers.get("location")).toBeNull();
  });
});
