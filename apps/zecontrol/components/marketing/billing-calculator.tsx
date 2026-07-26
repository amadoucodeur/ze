"use client";

import { useState } from "react";
import { Minus, Plus, ReceiptText } from "lucide-react";

type BillingCalculatorProps = {
  unitPrice: number;
};

const presets = [5, 10, 25, 50];

function formatPrice(value: number) {
  return new Intl.NumberFormat("fr-FR").format(value);
}

export function BillingCalculator({ unitPrice }: BillingCalculatorProps) {
  const [activeUsers, setActiveUsers] = useState(12);
  const total = activeUsers * unitPrice;

  function updateUsers(value: number) {
    setActiveUsers(Math.min(100, Math.max(1, value)));
  }

  return (
    <article className="landing-calculator">
      <header>
        <span className="landing-calculator-icon"><ReceiptText size={21} /></span>
        <div>
          <small>Estimation instantanée</small>
          <h3>Votre facture du mois</h3>
        </div>
        <span className="landing-calculator-live"><i /> Simulation</span>
      </header>

      <div className="landing-calculator-control">
        <div className="landing-calculator-label">
          <label htmlFor="active-users">Collaborateurs ayant pointé</label>
          <div className="landing-calculator-counter">
            <button
              type="button"
              onClick={() => updateUsers(activeUsers - 1)}
              aria-label="Retirer un collaborateur"
            >
              <Minus size={16} />
            </button>
            <output htmlFor="active-users" aria-live="polite">{activeUsers}</output>
            <button
              type="button"
              onClick={() => updateUsers(activeUsers + 1)}
              aria-label="Ajouter un collaborateur"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        <input
          id="active-users"
          type="range"
          min="1"
          max="100"
          value={activeUsers}
          onChange={(event) => updateUsers(Number(event.target.value))}
          style={{ "--billing-progress": `${activeUsers}%` } as React.CSSProperties}
        />

        <div className="landing-calculator-presets" aria-label="Exemples d’effectifs">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={activeUsers === preset ? "is-active" : undefined}
              onClick={() => updateUsers(preset)}
            >
              {preset} personnes
            </button>
          ))}
        </div>
      </div>

      <div className="landing-calculator-invoice">
        <div>
          <span>Accès créés</span>
          <strong>Gratuit</strong>
        </div>
        <div>
          <span>{activeUsers} utilisateurs actifs × {formatPrice(unitPrice)} F</span>
          <strong>{formatPrice(total)} F</strong>
        </div>
        <div className="landing-calculator-total">
          <span>Total estimé</span>
          <output aria-live="polite">{formatPrice(total)} <small>F CFA</small></output>
        </div>
      </div>

      <p className="landing-calculator-note">
        Exemple : les comptes qui ne pointent pas ce mois-ci restent à 0 F.
      </p>
    </article>
  );
}
