"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("ZeControl dashboard:", error);
  }, [error]);

  return (
    <section className="dashboard-route-error" role="alert">
      <span><AlertTriangle size={25} /></span>
      <h1>Cette page n’a pas pu être chargée.</h1>
      <p>Vos données ne sont pas perdues. Vérifiez votre connexion puis réessayez.</p>
      <button className="button button-primary" type="button" onClick={() => unstable_retry()}><RefreshCw size={17} /> Réessayer</button>
      {error.digest && <small>Référence : {error.digest}</small>}
    </section>
  );
}
