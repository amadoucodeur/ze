import {
  CV_FILE_MAX_SIZE,
  CV_TEXT_MAX_LENGTH,
  CV_TEXT_MIN_LENGTH,
  type CvImportItem,
} from "./schema";

export const ACCEPTED_CV_EXTENSIONS = ".pdf,.docx,.txt,.md";

function normalizeExtractedText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getExtension(file: File) {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

async function extractPdf(file: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : ""))
      .join("");
    pages.push(pageText);
    page.cleanup();
  }

  await loadingTask.destroy();
  return pages.join("\n\n");
}

async function extractDocx(file: File) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

export async function extractCvFile(file: File): Promise<Omit<CvImportItem, "clientId">> {
  if (file.size > CV_FILE_MAX_SIZE) {
    throw new Error("Ce fichier dépasse 10 Mo. Compressez-le puis réessayez.");
  }

  const extension = getExtension(file);
  let sourceType: CvImportItem["sourceType"];
  let rawText: string;

  if (extension === "pdf") {
    sourceType = "pdf";
    rawText = await extractPdf(file);
  } else if (extension === "docx") {
    sourceType = "docx";
    rawText = await extractDocx(file);
  } else if (extension === "txt" || extension === "md") {
    sourceType = "text";
    rawText = await file.text();
  } else {
    throw new Error("Format non pris en charge. Utilisez un PDF, DOCX, TXT ou MD.");
  }

  const text = normalizeExtractedText(rawText);
  if (text.length < CV_TEXT_MIN_LENGTH) {
    const isPdf = extension === "pdf";
    throw new Error(
      isPdf
        ? "Aucun texte exploitable n’a été trouvé. Si le PDF est scanné, utilisez une version avec texte ou collez son contenu manuellement."
        : "Le document ne contient pas assez de texte exploitable.",
    );
  }
  if (text.length > CV_TEXT_MAX_LENGTH) {
    throw new Error("Le document dépasse 60 000 caractères. Réduisez-le puis réessayez.");
  }

  return { sourceName: file.name, sourceType, text };
}
