"use client";

import { useState } from "react";
import { ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";
import type { BillingCycle, PaidPlanCode } from "@/lib/billing/plans";

export function CheckoutButton({
  plan,
  cycle,
  label,
  featured = false,
}: {
  plan: PaidPlanCode;
  cycle: BillingCycle;
  label: string;
  featured?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function checkout() {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, cycle }),
      });
      const result = await response.json().catch(() => null) as { checkoutUrl?: string; message?: string } | null;
      if (!response.ok || !result?.checkoutUrl) throw new Error(result?.message || "Le paiement n’a pas pu être préparé.");
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Le paiement n’a pas pu être préparé.");
      setPending(false);
    }
  }

  return <div className="billing-checkout-action">
    <button className={`button ${featured ? "button-lime" : "button-primary"}`} type="button" disabled={pending} onClick={checkout}>
      {pending ? <><LoaderCircle className="spin" size={18} /> Préparation sécurisée…</> : <><ShieldCheck size={18} /> {label} <ArrowRight size={17} /></>}
    </button>
    {message && <p role="alert">{message}</p>}
  </div>;
}
