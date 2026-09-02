export type ExportCell = string | number;

export type ExcelExportSheet = {
  name: string;
  title: string;
  headers: string[];
  rows: ExportCell[][];
};

export type PdfExportSection = {
  title: string;
  subtitle: string;
  headers: string[];
  rows: ExportCell[][];
};

function escapeCsv(value: ExportCell) {
  const text = String(value).replaceAll('"', '""');
  return `"${text}"`;
}

function downloadBlob(filename: string, type: string, content: BlobPart) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(filename: string, headers: string[], rows: ExportCell[][]) {
  const content = [headers, ...rows].map((row) => row.map(escapeCsv).join(";")).join("\n");
  downloadBlob(`${filename}.csv`, "text/csv;charset=utf-8", `\uFEFF${content}`);
}

function uniqueWorksheetName(name: string, index: number, usedNames: Set<string>) {
  const fallback = `Collaborateur ${index + 1}`;
  const baseName = name
    .replace(/[\\/:*?[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^'+|'+$/g, "")
    .trim() || fallback;
  let suffix = "";
  let occurrence = 1;
  let worksheetName = baseName.slice(0, 31);

  while (usedNames.has(worksheetName.toLocaleLowerCase("fr"))) {
    occurrence += 1;
    suffix = ` (${occurrence})`;
    worksheetName = `${baseName.slice(0, 31 - suffix.length)}${suffix}`;
  }
  usedNames.add(worksheetName.toLocaleLowerCase("fr"));
  return worksheetName;
}

export async function exportExcelWorkbook(filename: string, sheets: ExcelExportSheet[]) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ZeControl";
  workbook.created = new Date();
  const usedNames = new Set<string>();
  const exportSheets = sheets.length
    ? sheets
    : [{ name: "Rapport", title: "Rapport", headers: ["Information"], rows: [["Aucune donnée"]] }];

  exportSheets.forEach(({ name, title, headers, rows }, index) => {
    const sheet = workbook.addWorksheet(uniqueWorksheetName(name, index, usedNames), {
      views: [{ state: "frozen", ySplit: 2 }],
    });
    sheet.mergeCells(1, 1, 1, Math.max(1, headers.length));
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = title;
    titleCell.font = { bold: true, color: { argb: "FF003F5D" }, size: 18 };
    titleCell.alignment = { vertical: "middle" };
    sheet.getRow(1).height = 34;

    const headerRow = sheet.addRow(headers);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF003F5D" } };
      cell.alignment = { vertical: "middle" };
    });
    rows.forEach((row) => sheet.addRow(row));
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 2) return;
      row.height = 24;
      row.eachCell((cell) => {
        cell.alignment = { vertical: "middle" };
        cell.border = { bottom: { style: "hair", color: { argb: "FFDDE7E4" } } };
      });
    });
    headers.forEach((header, columnIndex) => {
      const values = rows.map((row) => String(row[columnIndex] ?? ""));
      sheet.getColumn(columnIndex + 1).width = Math.min(42, Math.max(14, header.length + 3, ...values.map((value) => value.length + 2)));
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(`${filename}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer as BlobPart);
}

export async function exportExcel(filename: string, title: string, headers: string[], rows: ExportCell[][]) {
  await exportExcelWorkbook(filename, [{ name: "Rapport", title, headers, rows }]);
}

export async function exportPdfSections(filename: string, sections: PdfExportSection[]) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const document = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const exportSections = sections.length
    ? sections
    : [{ title: "Rapport", subtitle: "Aucune donnée", headers: ["Information"], rows: [["Aucune donnée"]] }];

  exportSections.forEach(({ title, subtitle, headers, rows }, index) => {
    if (index > 0) document.addPage();
    document.setTextColor(0, 63, 93);
    document.setFontSize(19);
    document.text(title, 14, 16);
    document.setTextColor(99, 120, 126);
    document.setFontSize(9);
    document.text(subtitle, 14, 22);
    autoTable(document, {
      head: [headers],
      body: rows,
      startY: 28,
      theme: "striped",
      styles: { fontSize: 7.5, cellPadding: 2.5, textColor: [38, 63, 72] },
      headStyles: { fillColor: [0, 63, 93], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 248, 247] },
      margin: { left: 10, right: 10 },
    });
  });
  document.save(`${filename}.pdf`);
}

export async function exportPdf(filename: string, title: string, subtitle: string, headers: string[], rows: ExportCell[][]) {
  await exportPdfSections(filename, [{ title, subtitle, headers, rows }]);
}
