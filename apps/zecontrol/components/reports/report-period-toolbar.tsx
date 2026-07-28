"use client";

import { useState } from "react";
import { CalendarRange, ChevronDown, Download, FileSpreadsheet, FileText, Table2 } from "lucide-react";
import type { ReportPeriod } from "@/lib/reports/period";

const periods: Array<{ value: ReportPeriod; label: string }> = [
  { value: "day", label: "Jour" },
  { value: "week", label: "Semaine" },
  { value: "month", label: "Mois" },
  { value: "all", label: "Tout" },
  { value: "custom", label: "Personnalisé" },
];

export function ReportPeriodToolbar({
  period,
  start,
  end,
  onPeriodChange,
  onStartChange,
  onEndChange,
  onExport,
  exportScopes = false,
  exportScopeLabels,
}: {
  period: ReportPeriod;
  start: string;
  end: string;
  onPeriodChange: (period: ReportPeriod) => void;
  onStartChange: (date: string) => void;
  onEndChange: (date: string) => void;
  onExport: (format: "pdf" | "excel" | "csv", scope?: "summary" | "detail") => void | Promise<void>;
  exportScopes?: boolean;
  exportScopeLabels?: {
    summaryTitle: string;
    summaryDescription: string;
    detailTitle: string;
    detailDescription: string;
  };
}) {
  const [exporting, setExporting] = useState<"pdf" | "excel" | "csv" | null>(null);
  const [exportScope, setExportScope] = useState<"summary" | "detail">("summary");

  async function runExport(format: "pdf" | "excel" | "csv") {
    if (exporting) return;
    setExporting(format);
    try {
      await onExport(format, exportScope);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="report-period-toolbar">
      <div className="report-period-presets" aria-label="Période du rapport">{periods.map((item) => <button className={period === item.value ? "active" : ""} type="button" aria-label={item.label} onClick={() => onPeriodChange(item.value)} key={item.value}><span className="report-period-label">{item.label}</span>{item.value === "custom" && <span className="report-period-label-mobile" aria-hidden="true">Dates</span>}</button>)}</div>
      {period === "custom" && <div className="report-custom-dates"><label><span>Du</span><CalendarRange size={14} /><input type="date" value={start} max={end || undefined} onChange={(event) => onStartChange(event.target.value)} /></label><label><span>Au</span><CalendarRange size={14} /><input type="date" value={end} min={start || undefined} onChange={(event) => onEndChange(event.target.value)} /></label></div>}
      <details className="report-export-menu"><summary><Download size={15} /> {exporting ? "Préparation..." : "Exporter"} <ChevronDown size={13} /></summary><div>{exportScopes && <div className="report-export-scope" aria-label="Contenu de l’export"><button className={exportScope === "summary" ? "active" : ""} type="button" aria-pressed={exportScope === "summary"} onClick={() => setExportScope("summary")}><strong>{exportScopeLabels?.summaryTitle ?? "Résumé"}</strong><small>{exportScopeLabels?.summaryDescription ?? "Une ligne par collaborateur"}</small></button><button className={exportScope === "detail" ? "active" : ""} type="button" aria-pressed={exportScope === "detail"} onClick={() => setExportScope("detail")}><strong>{exportScopeLabels?.detailTitle ?? "Détail"}</strong><small>{exportScopeLabels?.detailDescription ?? "Une ligne par journée"}</small></button></div>}<button type="button" disabled={Boolean(exporting)} onClick={() => void runExport("pdf")}><FileText size={16} /><span><strong>{exporting === "pdf" ? "Création..." : "PDF"}</strong><small>Fichier prêt à partager</small></span></button><button type="button" disabled={Boolean(exporting)} onClick={() => void runExport("excel")}><FileSpreadsheet size={16} /><span><strong>{exporting === "excel" ? "Création..." : "Excel"}</strong><small>Classeur .xlsx</small></span></button><button type="button" disabled={Boolean(exporting)} onClick={() => void runExport("csv")}><Table2 size={16} /><span><strong>{exporting === "csv" ? "Création..." : "CSV"}</strong><small>Données filtrées</small></span></button></div></details>
    </div>
  );
}
