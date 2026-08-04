import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

type PayDunyaMode = "test" | "production";

type PayDunyaConfig = {
  mode: PayDunyaMode;
  masterKey: string;
  privateKey: string;
  token: string;
  apiBase: string;
};

export type PayDunyaInvoiceData = {
  response_code?: string;
  response_text?: string;
  hash?: string;
  status?: string;
  invoice?: {
    token?: string;
    total_amount?: string | number;
  };
  custom_data?: Record<string, unknown>;
  receipt_url?: string;
  fail_reason?: string;
};

type CreateCheckoutInput = {
  amount: number;
  unitPrice: number;
  userCount: number;
  periodLabel: string;
  periodId: string;
  internalReference: string;
  organisationId: string;
  organisationName: string;
  customer: {
    name: string;
    email?: string | null;
    phone?: string | null;
  };
  callbackUrl: string;
  returnUrl: string;
  cancelUrl: string;
};

function required(value: string | undefined, label: string) {
  if (!value?.trim()) throw new Error(`${label} n’est pas configurée.`);
  return value.trim();
}

function resolvePayDunyaMode(): PayDunyaMode {
  const configured = process.env.PAYDUNYA_MODE?.trim();
  if (configured !== "test" && configured !== "production") {
    throw new Error(
      "Le mode de paiement n’est pas correctement configuré.",
    );
  }

  const vercelEnvironment = process.env.VERCEL_ENV?.trim();
  if (
    vercelEnvironment === "production" &&
    configured !== "production"
  ) {
    throw new Error(
      "Le moyen de paiement de production n’est pas correctement configuré.",
    );
  }
  if (
    vercelEnvironment &&
    vercelEnvironment !== "production" &&
    configured === "production"
  ) {
    throw new Error(
      "Les clés de paiement de production sont interdites dans les déploiements Preview et Development.",
    );
  }

  return configured;
}

function assertMatchingPrivateKey(mode: PayDunyaMode, privateKey: string) {
  if (mode === "production" && privateKey.startsWith("test_")) {
    throw new Error(
      "La clé privée de production ressemble à une clé de test.",
    );
  }
  if (mode === "test" && privateKey.startsWith("live_")) {
    throw new Error(
      "La clé privée de test ressemble à une clé de production.",
    );
  }
}

function assertProductionActionUrl(
  value: string,
  label: string,
  mode: PayDunyaMode,
) {
  if (mode !== "production") return;

  const url = new URL(value);
  const isLocal =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" || isLocal) {
    throw new Error(
      `${label} doit être une URL HTTPS publique en mode production.`,
    );
  }
}

export function getPayDunyaConfig(): PayDunyaConfig {
  const mode = resolvePayDunyaMode();
  const privateKey =
    mode === "production"
      ? process.env.PAYDUNYA_PRIVATE_PRODUCTION_KEY
      : process.env.PAYDUNYA_PRIVATE_TEST_KEY;
  const token =
    mode === "production"
      ? process.env.PAYDUNYA_TOKEN_PRODUCTION
      : process.env.PAYDUNYA_TOKEN_TEST;
  const resolvedPrivateKey = required(
    privateKey,
    `La clé privée de paiement ${mode}`,
  );
  assertMatchingPrivateKey(mode, resolvedPrivateKey);

  return {
    mode,
    masterKey: required(
      process.env.PAYDUNYA_PRINCIPAL_KEY,
      "La clé principale de paiement",
    ),
    privateKey: resolvedPrivateKey,
    token: required(token, `Le jeton de paiement ${mode}`),
    apiBase:
      mode === "production"
        ? "https://app.paydunya.com/api/v1"
        : "https://app.paydunya.com/sandbox-api/v1",
  };
}

function headers(config: PayDunyaConfig) {
  return {
    "Content-Type": "application/json",
    "PAYDUNYA-MASTER-KEY": config.masterKey,
    "PAYDUNYA-PRIVATE-KEY": config.privateKey,
    "PAYDUNYA-TOKEN": config.token,
  };
}

async function readJson(response: Response) {
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok || !payload) {
    throw new Error(
      "Le service de paiement n’a pas répondu correctement. Réessayez dans un instant.",
    );
  }
  return payload;
}

function isPayDunyaCheckoutUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "paydunya.com" ||
        url.hostname.endsWith(".paydunya.com"))
    );
  } catch {
    return false;
  }
}

export async function createPayDunyaCheckout(input: CreateCheckoutInput) {
  const config = getPayDunyaConfig();
  assertProductionActionUrl(
    input.callbackUrl,
    "L’URL de notification du paiement",
    config.mode,
  );
  assertProductionActionUrl(
    input.returnUrl,
    "L’URL de retour du paiement",
    config.mode,
  );
  assertProductionActionUrl(
    input.cancelUrl,
    "L’URL d’annulation du paiement",
    config.mode,
  );
  const customer = Object.fromEntries(
    Object.entries({
      name: input.customer.name,
      email: input.customer.email || undefined,
      phone: input.customer.phone || undefined,
    }).filter(([, value]) => Boolean(value)),
  );

  const response = await fetch(`${config.apiBase}/checkout-invoice/create`, {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({
      invoice: {
        items: {
          item_0: {
            name: "Utilisateurs ZeControl actifs",
            quantity: input.userCount,
            unit_price: input.unitPrice,
            total_price: input.amount,
            description: input.periodLabel,
          },
        },
        total_amount: input.amount,
        description: `Facture ZeControl — ${input.periodLabel}`,
        customer,
      },
      store: {
        name: "ZeControl",
        tagline: "Le suivi du temps, simplement",
      },
      custom_data: {
        payment_reference: input.internalReference,
        organisation_id: input.organisationId,
        product_code: "zecontrol",
        billing_period_id: input.periodId,
      },
      actions: {
        callback_url: input.callbackUrl,
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const payload = await readJson(response);
  const responseCode = String(payload.response_code ?? "");
  const checkoutUrl =
    typeof payload.response_text === "string" ? payload.response_text : "";
  const token = typeof payload.token === "string" ? payload.token : "";
  if (responseCode !== "00") {
    throw new Error(
      "Le service de paiement n’a pas pu préparer le règlement. Réessayez dans un instant.",
    );
  }
  if (!isPayDunyaCheckoutUrl(checkoutUrl) || !token) {
    throw new Error(
      "Le paiement a été préparé, mais la redirection n’a pas été reçue.",
    );
  }
  return {
    checkoutUrl,
    token,
    responseCode,
    responseText: checkoutUrl,
    mode: config.mode,
  };
}

export async function confirmPayDunyaCheckout(
  token: string,
): Promise<PayDunyaInvoiceData> {
  const config = getPayDunyaConfig();
  const safeToken = encodeURIComponent(token);
  const response = await fetch(
    `${config.apiBase}/checkout-invoice/confirm/${safeToken}`,
    {
      method: "GET",
      headers: headers(config),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  return (await readJson(response)) as PayDunyaInvoiceData;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left.toLowerCase(), "utf8");
  const b = Buffer.from(right.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyPayDunyaHash(hash: string | null | undefined) {
  if (!hash) return false;
  const expected = createHash("sha512")
    .update(getPayDunyaConfig().masterKey)
    .digest("hex");
  return safeEqual(hash, expected);
}

export function fingerprintPayDunyaPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function assignNested(
  target: Record<string, unknown>,
  path: string[],
  value: string,
) {
  let current = target;
  path.forEach((part, index) => {
    if (index === path.length - 1) {
      current[part] = value;
      return;
    }
    const next = current[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  });
}

export function parsePayDunyaFormData(
  formData: FormData,
): PayDunyaInvoiceData | null {
  const direct = formData.get("data");
  if (typeof direct === "string") {
    try {
      const parsed = JSON.parse(direct) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as PayDunyaInvoiceData;
      }
    } catch {
      // PayDunya also sends PHP-style nested form keys.
    }
  }

  const root: Record<string, unknown> = {};
  for (const [key, rawValue] of formData.entries()) {
    if (typeof rawValue !== "string") continue;
    const parts = Array.from(
      key.matchAll(/([^\[\]]+)/g),
      (match) => match[1],
    );
    const path = parts[0] === "data" ? parts.slice(1) : parts;
    if (path.length) assignNested(root, path, rawValue);
  }
  return Object.keys(root).length
    ? (root as PayDunyaInvoiceData)
    : null;
}

export function normalizedPayDunyaStatus(
  value: string | null | undefined,
) {
  const status = value?.toLowerCase();
  if (status === "completed") return "completed" as const;
  if (status === "cancelled" || status === "canceled") {
    return "cancelled" as const;
  }
  if (status === "failed") return "failed" as const;
  return "pending" as const;
}
