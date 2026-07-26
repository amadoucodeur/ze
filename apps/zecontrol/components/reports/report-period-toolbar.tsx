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
}: {
  period: ReportPeriod;
  start: string;
  end: string;
  onPeriodChange: (period: ReportPeriod) => void;
  onStartChange: (date: string) => void;
  onEndChange: (date: string) => void;
  onExport: (format: "pdf" | "excel" | "csv") => void | Promise<void>;
}) {
  const [exporting, setExporting] = useState<"pdf" | "excel" | "csv" | null>(null);

  async function runExport(format: "pdf" | "excel" | "csv") {
    if (exporting) return;
    setExporting(format);
    try {
      await onExport(format);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="report-period-toolbar">
      <div className="report-period-presets" aria-label="Période du rapport">{periods.map((item) => <button className={period === item.value ? "active" : ""} type="button" aria-label={item.label} onClick={() => onPeriodChange(item.value)} key={item.value}><span className="report-period-label">{item.label}</span>{item.value === "custom" && <span className="report-period-label-mobile" aria-hidden="true">Dates</span>}</button>)}</div>
      {period === "custom" && <div className="report-custom-dates"><label><span>Du</span><CalendarRange size={14} /><input type="date" value={start} max={end || undefined} onChange={(event) => onStartChange(event.target.value)} /></label><label><span>Au</span><CalendarRange size={14} /><input type="date" value={end} min={start || undefined} onChange={(event) => onEndChange(event.target.value)} /></label></div>}
      <details className="report-export-menu"><summary><Download size={15} /> {exporting ? "Préparation..." : "Exporter"} <ChevronDown size={13} /></summary><div><button type="button" disabled={Boolean(exporting)} onClick={() => void runExport("pdf")}><FileText size={16} /><span><strong>{exporting === "pdf" ? "Création..." : "PDF"}</strong><small>Fichier prêt à partager</small></span></button><button type="button" disabled={Boolean(exporting)} onClick={() => void runExport("excel")}><FileSpreadsheet size={16} /><span><strong>{exporting === "excel" ? "Création..." : "Excel"}</strong><small>Classeur .xlsx</small></span></button><button type="button" disabled={Boolean(exporting)} onClick={() => void runExport("csv")}><Table2 size={16} /><span><strong>{exporting === "csv" ? "Création..." : "CSV"}</strong><small>Données brutes</small></span></button></div></details>
    </div>
  );
}
