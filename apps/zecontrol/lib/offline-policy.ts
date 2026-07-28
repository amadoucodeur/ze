export type OfflinePolicy = "strict" | "flexible" | "free";

export const offlinePolicyOptions: Array<{
  value: OfflinePolicy;
  label: string;
}> = [
  { value: "strict", label: "Ne pas autoriser" },
  { value: "flexible", label: "Envoyer pour validation" },
  { value: "free", label: "Accepter après synchronisation" },
];

export const offlinePolicyCopy: Record<
  OfflinePolicy,
  { title: string; description: string }
> = {
  strict: {
    title: "Hors connexion : indisponible",
    description: "Le collaborateur devra retrouver une connexion pour pointer.",
  },
  flexible: {
    title: "Hors connexion : validation requise",
    description: "Le pointage sera synchronisé puis soumis à un administrateur.",
  },
  free: {
    title: "Hors connexion : accepté",
    description: "Le pointage sera accepté lors de sa synchronisation.",
  },
};

