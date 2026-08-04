"use client";

import { useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";

export function CheckoutButton({
  periodId,
  label = "Régler la facture",
}: {
  periodId: string;
  label?: string;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function checkout() {
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodId }),
      });
      const result = (await response.json().catch(() => null)) as {
        checkoutUrl?: string;
        message?: string;
      } | null;
      if (!response.ok || !result?.checkoutUrl) {
        throw new Error(
          result?.message || "Le paiement n’a pas pu être préparé.",
        );
      }
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Le paiement n’a pas pu être préparé.",
      );
      setPending(false);
    }
  }

  return (
    <div className="zec-checkout-action">
      <button
        className="button button-primary"
        type="button"
        disabled={pending}
        onClick={checkout}
      >
        {pending ? (
          <LoaderCircle className="spin" size={17} />
        ) : (
          <ArrowRight size={17} />
        )}
        {pending ? "Préparation…" : label}
      </button>
      {message && <p role="alert">{message}</p>}
    </div>
  );
}
