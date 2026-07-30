"use client";

import { useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  RotateCcw,
  Table2,
} from "lucide-react";

type ExportFormat = "pdf" | "excel" | "csv";
type ExportScope = "summary" | "detail";

function shiftDay(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function LiveDayToolbar({
  day,
  today,
  onDayChange,
  onExport,
}: {
  day: string;
  today: string;
  onDayChange: (day: string) => void;
  onExport: (format: ExportFormat, scope: ExportScope) => void | Promise<void>;
}) {
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportScope, setExportScope] = useState<ExportScope>("summary");
  const isToday = day === today;

  async function runExport(format: ExportFormat) {
    if (exporting) return;
    setExporting(format);
    try {
      await onExport(format, exportScope);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="live-day-toolbar">
      <div className="live-day-navigation">
        <button
          type="button"
          aria-label="Jour précédent"
          onClick={() => onDayChange(shiftDay(day, -1))}
        >
          <ChevronLeft size={17} />
        </button>
        <label>
          <CalendarDays size={17} />
          <span className="sr-only">Journée affichée</span>
          <input
            type="date"
            value={day}
            max={today}
            onChange={(event) => {
              if (event.target.value) onDayChange(event.target.value);
            }}
          />
        </label>
        <button
          type="button"
          aria-label="Jour suivant"
          disabled={isToday}
          onClick={() => onDayChange(shiftDay(day, 1))}
        >
          <ChevronRight size={17} />
        </button>
      </div>

      {!isToday && (
        <button
          className="live-day-today"
          type="button"
          onClick={() => onDayChange(today)}
        >
          <RotateCcw size={15} />
          Aujourd’hui
        </button>
      )}

      <details className="report-export-menu live-day-export">
        <summary>
          <Download size={15} />
          {exporting ? "Préparation..." : "Exporter"}
          <ChevronDown size={13} />
        </summary>
        <div>
          <div className="report-export-scope" aria-label="Contenu de l’export">
            <button
              className={exportScope === "summary" ? "active" : ""}
              type="button"
              aria-pressed={exportScope === "summary"}
              onClick={() => setExportScope("summary")}
            >
              <strong>Résumé</strong>
              <small>Une ligne par collaborateur</small>
            </button>
            <button
              className={exportScope === "detail" ? "active" : ""}
              type="button"
              aria-pressed={exportScope === "detail"}
              onClick={() => setExportScope("detail")}
            >
              <strong>Détail</strong>
              <small>Avec la chronologie</small>
            </button>
          </div>
          <button
            type="button"
            disabled={Boolean(exporting)}
            onClick={() => void runExport("pdf")}
          >
            <FileText size={16} />
            <span>
              <strong>{exporting === "pdf" ? "Création..." : "PDF"}</strong>
              <small>Fichier prêt à partager</small>
            </span>
          </button>
          <button
            type="button"
            disabled={Boolean(exporting)}
            onClick={() => void runExport("excel")}
          >
            <FileSpreadsheet size={16} />
            <span>
              <strong>{exporting === "excel" ? "Création..." : "Excel"}</strong>
              <small>Classeur .xlsx</small>
            </span>
          </button>
          <button
            type="button"
            disabled={Boolean(exporting)}
            onClick={() => void runExport("csv")}
          >
            <Table2 size={16} />
            <span>
              <strong>{exporting === "csv" ? "Création..." : "CSV"}</strong>
              <small>Données filtrées</small>
            </span>
          </button>
        </div>
      </details>
    </div>
  );
}
