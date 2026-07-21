import {
  CV_FILE_MAX_SIZE,
  CV_TEXT_MAX_LENGTH,
  CV_TEXT_MIN_LENGTH,
  type CvImportItem,
} from "./schema";

export const ACCEPTED_CV_EXTENSIONS = ".pdf,.png,.jpg,.jpeg,.webp,.docx,.txt,.md";

export type ClientExtractionProgress = {
  stage: "reading" | "ocr";
  message: string;
  progress?: number;
};

export type ExtractedCvFile = Omit<CvImportItem, "clientId"> & {
  ocrUsed: boolean;
  ocrPageCount: number;
};

let ocrWorkerPromise: ReturnType<typeof createOcrWorker> | null = null;
let ocrQueue: Promise<unknown> = Promise.resolve();
let ocrProgressListener: ((progress: ClientExtractionProgress) => void) | undefined;

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

async function createOcrWorker() {
  const { createWorker } = await import("tesseract.js");
  return createWorker(["fra", "eng"], undefined, {
    logger: (event) => {
      if (event.status === "recognizing text") {
        ocrProgressListener?.({
          stage: "ocr",
          message: `Reconnaissance du texte… ${Math.round(event.progress * 100)} %`,
          progress: event.progress,
        });
      }
    },
  });
}

function runOcr<T>(operation: (worker: Awaited<ReturnType<typeof createOcrWorker>>) => Promise<T>) {
  const next = ocrQueue.then(async () => {
    ocrWorkerPromise ??= createOcrWorker();
    return operation(await ocrWorkerPromise);
  });
  ocrQueue = next.catch(() => undefined);
  return next;
}

async function recognizeCanvas(
  canvas: HTMLCanvasElement,
  onProgress?: (progress: ClientExtractionProgress) => void,
) {
  return runOcr(async (worker) => {
    onProgress?.({ stage: "ocr", message: "Reconnaissance du texte sur cet appareil…" });
    ocrProgressListener = onProgress;
    try {
      const result = await worker.recognize(canvas);
      return result.data.text;
    } finally {
      ocrProgressListener = undefined;
    }
  });
}

async function extractPdf(file: File, onProgress?: (progress: ClientExtractionProgress) => void) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdfDocument = await loadingTask.promise;
  const pages: string[] = [];
  let ocrPageCount = 0;

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    onProgress?.({
      stage: "reading",
      message: `Lecture de la page ${pageNumber} sur ${pdfDocument.numPages}…`,
      progress: (pageNumber - 1) / pdfDocument.numPages,
    });
    const page = await pdfDocument.getPage(pageNumber);
    const content = await page.getTextContent();
    let pageText = content.items
      .map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : ""))
      .join("");
    if (normalizeExtractedText(pageText).length < 24) {
      const viewport = page.getViewport({ scale: 1.7 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("L’OCR n’a pas pu préparer cette page.");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      onProgress?.({
        stage: "ocr",
        message: `Page scannée détectée · reconnaissance ${pageNumber}/${pdfDocument.numPages}…`,
        progress: (pageNumber - 1) / pdfDocument.numPages,
      });
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      pageText = await recognizeCanvas(canvas, onProgress);
      canvas.width = 1;
      canvas.height = 1;
      ocrPageCount += 1;
    }
    pages.push(pageText);
    page.cleanup();
  }

  await loadingTask.destroy();
  return { text: pages.join("\n\n"), ocrPageCount };
}

async function extractImage(file: File, onProgress?: (progress: ClientExtractionProgress) => void) {
  const image = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const maxDimension = 2400;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("L’image n’a pas pu être préparée pour la lecture.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const text = await recognizeCanvas(canvas, onProgress);
  canvas.width = 1;
  canvas.height = 1;
  return text;
}

async function extractDocx(file: File) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

export async function extractCvFile(
  file: File,
  onProgress?: (progress: ClientExtractionProgress) => void,
): Promise<ExtractedCvFile> {
  if (file.size > CV_FILE_MAX_SIZE) {
    throw new Error("Ce fichier dépasse 10 Mo. Compressez-le puis réessayez.");
  }

  const extension = getExtension(file);
  let sourceType: CvImportItem["sourceType"];
  let rawText: string;
  let ocrPageCount = 0;

  if (extension === "pdf") {
    sourceType = "pdf";
    const extracted = await extractPdf(file, onProgress);
    rawText = extracted.text;
    ocrPageCount = extracted.ocrPageCount;
  } else if (["png", "jpg", "jpeg", "webp"].includes(extension)) {
    sourceType = "image";
    rawText = await extractImage(file, onProgress);
    ocrPageCount = 1;
  } else if (extension === "docx") {
    sourceType = "docx";
    rawText = await extractDocx(file);
  } else if (extension === "txt" || extension === "md") {
    sourceType = "text";
    rawText = await file.text();
  } else {
    throw new Error("Format non pris en charge. Utilisez un PDF, une image, un DOCX, TXT ou MD.");
  }

  const text = normalizeExtractedText(rawText);
  if (text.length < CV_TEXT_MIN_LENGTH) {
    const isPdf = extension === "pdf";
    throw new Error(
      isPdf
        ? "Même après reconnaissance du document scanné, aucun texte exploitable n’a été trouvé. Essayez une image plus nette ou collez le contenu manuellement."
        : "Le document ne contient pas assez de texte exploitable.",
    );
  }
  if (text.length > CV_TEXT_MAX_LENGTH) {
    throw new Error("Le document dépasse 60 000 caractères. Réduisez-le puis réessayez.");
  }

  return { sourceName: file.name, sourceType, text, ocrUsed: ocrPageCount > 0, ocrPageCount };
}
