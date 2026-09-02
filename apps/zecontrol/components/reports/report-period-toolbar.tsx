"use client";

import { useState } from "react";
import { CalendarRange, ChevronDown, Download, FileSpreadsheet, FileText, Table2 } from "lucide-react";
import type { ReportPeriod } from "@/lib/reports/period";

const quickPeriods: Array<{ value: ReportPeriod; label: string }> = [
  { value: "day", label: "Aujourd’hui" },
  { value: "week", label: "Cette semaine" },
  { value: "month", label: "Ce mois" },
];

const otherPeriods: Array<{ value: ReportPeriod; label: string }> = [
  { value: "yesterday", label: "Hier" },
  { value: "lastWeek", label: "Semaine dernière" },
  { value: "lastMonth", label: "Mois dernier" },
  { value: "all", label: "Toutes les données" },
  { value: "custom", label: "Dates personnalisées" },
];

function shortDate(value: string) {
  if (!value) return "Début des données";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(`${value}T12:00:00`));
}

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
  const isOtherPeriod = otherPeriods.some((item) => item.value === period);
  const rangeSummary = start === end && start
    ? shortDate(start)
    : `${shortDate(start)} — ${shortDate(end)}`;

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
      <div className="report-period-heading"><span><CalendarRange size={18} /></span><div><small>Période du rapport</small><strong>{rangeSummary}</strong></div></div>
      <div className="report-period-presets" aria-label="Périodes courantes">{quickPeriods.map((item) => <button className={period === item.value ? "active" : ""} type="button" aria-pressed={period === item.value} onClick={() => onPeriodChange(item.value)} key={item.value}>{item.label}</button>)}</div>
      <label className={`report-period-other ${isOtherPeriod ? "active" : ""}`}><span className="sr-only">Autres périodes</span><select aria-label="Autres périodes" value={isOtherPeriod ? period : ""} onChange={(event) => onPeriodChange(event.target.value as ReportPeriod)}><option value="" disabled>Autres périodes</option>{otherPeriods.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></label>
      {period === "custom" && <div className="report-custom-dates"><label><span>Du</span><CalendarRange size={14} /><input type="date" value={start} max={end || undefined} onChange={(event) => onStartChange(event.target.value)} /></label><label><span>Au</span><CalendarRange size={14} /><input type="date" value={end} min={start || undefined} onChange={(event) => onEndChange(event.target.value)} /></label></div>}
      <details className="report-export-menu"><summary><Download size={15} /> {exporting ? "Préparation..." : "Exporter"} <ChevronDown size={13} /></summary><div>{exportScopes && <div className="report-export-scope" aria-label="Contenu de l’export"><button className={exportScope === "summary" ? "active" : ""} type="button" aria-pressed={exportScope === "summary"} onClick={() => setExportScope("summary")}><strong>{exportScopeLabels?.summaryTitle ?? "Résumé"}</strong><small>{exportScopeLabels?.summaryDescription ?? "Une ligne par collaborateur"}</small></button><button className={exportScope === "detail" ? "active" : ""} type="button" aria-pressed={exportScope === "detail"} onClick={() => setExportScope("detail")}><strong>{exportScopeLabels?.detailTitle ?? "Détail"}</strong><small>{exportScopeLabels?.detailDescription ?? "Une ligne par journée"}</small></button></div>}<button type="button" disabled={Boolean(exporting)} onClick={() => void runExport("pdf")}><FileText size={16} /><span><strong>{exporting === "pdf" ? "Création..." : "PDF"}</strong><small>Fichier prêt à partager</small></span></button><button type="button" disabled={Boolean(exporting)} onClick={() => void runExport("excel")}><FileSpreadsheet size={16} /><span><strong>{exporting === "excel" ? "Création..." : "Excel"}</strong><small>Classeur .xlsx</small></span></button><button type="button" disabled={Boolean(exporting)} onClick={() => void runExport("csv")}><Table2 size={16} /><span><strong>{exporting === "csv" ? "Création..." : "CSV"}</strong><small>Données filtrées</small></span></button></div></details>
    </div>
  );
}
