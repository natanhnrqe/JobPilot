import path from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { AppError } from "../domain/errors.js";

/**
 * Extração de texto de currículos (PDF, DOCX e TXT), sem rede.
 *
 * O arquivo original NÃO é retido: o serviço devolve apenas o texto. Limites
 * de tamanho e de caracteres protegem a memória e o prompt da IA.
 */
export const MAX_CV_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_CV_TEXT_CHARS = 200_000;

export type CvFormat = "pdf" | "docx" | "txt";

export interface CvFileInput {
  fileName: string;
  content: Buffer;
}

export interface CvTextResult {
  text: string;
  format: CvFormat;
}

export async function extractCvText(input: CvFileInput): Promise<CvTextResult> {
  const { fileName, content } = input;

  if (content.length === 0) {
    throw new AppError("VALIDATION_ERROR", 400, "O arquivo do currículo está vazio.");
  }
  if (content.length > MAX_CV_FILE_BYTES) {
    throw new AppError(
      "VALIDATION_ERROR",
      400,
      `O arquivo do currículo excede o limite de ${MAX_CV_FILE_BYTES / (1024 * 1024)} MB.`,
    );
  }

  const format = detectFormat(fileName, content);
  const raw =
    format === "pdf"
      ? await extractPdf(content)
      : format === "docx"
        ? await extractDocx(content)
        : content.toString("utf8");

  const text = normalizeCvText(raw);
  if (text.length < 30) {
    throw new AppError(
      "CV_ERROR",
      422,
      format === "pdf"
        ? "O PDF não contém texto suficiente. Se ele for uma imagem digitalizada, aplique OCR ou envie uma versão em texto."
        : "O currículo não contém texto suficiente para extração. Envie uma versão com o conteúdo legível.",
    );
  }

  return { text, format };
}

function detectFormat(fileName: string, content: Buffer): CvFormat {
  const ext = path.extname(fileName).toLowerCase();
  const isPdfMagic = content.subarray(0, 5).toString("latin1") === "%PDF-";
  const isZipMagic = content.length >= 2 && content[0] === 0x50 && content[1] === 0x4b;
  // Assinatura OLE (antigo .doc do Word): não suportado.
  const isOleMagic =
    content.length >= 4 &&
    content[0] === 0xd0 &&
    content[1] === 0xcf &&
    content[2] === 0x11 &&
    content[3] === 0xe0;

  if (isPdfMagic) return "pdf";
  if (isZipMagic) return "docx";
  if (isOleMagic || ext === ".doc") {
    throw new AppError(
      "VALIDATION_ERROR",
      400,
      "O formato .doc antigo não é suportado. Salve o currículo como PDF ou DOCX e tente novamente.",
    );
  }
  if (ext === ".pdf") {
    throw new AppError(
      "CV_ERROR",
      422,
      "O arquivo não parece um PDF válido. Verifique se ele não está corrompido.",
    );
  }
  if (ext === ".docx") {
    throw new AppError(
      "CV_ERROR",
      422,
      "O arquivo não parece um DOCX válido. Verifique se ele não está corrompido.",
    );
  }
  if (ext === ".txt" || ext === ".md" || ext === ".text") return "txt";

  throw new AppError(
    "VALIDATION_ERROR",
    400,
    "Formato não suportado. Envie o currículo em PDF, DOCX ou TXT.",
  );
}

async function extractPdf(content: Buffer): Promise<string> {
  const parser = new PDFParse({ data: content });
  try {
    const result = await parser.getText();
    return result.text;
  } catch (err) {
    throw new AppError(
      "CV_ERROR",
      422,
      "Não foi possível ler o PDF. Ele pode estar protegido, corrompido ou ser uma imagem sem texto (digitalize com OCR e tente novamente).",
      { motivo: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) },
    );
  } finally {
    await parser.destroy().catch(() => {
      // O parser já pode ter sido encerrado após um erro de leitura.
    });
  }
}

async function extractDocx(content: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer: content });
    return result.value;
  } catch (err) {
    throw new AppError(
      "CV_ERROR",
      422,
      "Não foi possível ler o DOCX. Verifique se o arquivo não está corrompido e tente novamente.",
      { motivo: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) },
    );
  }
}

/** Normaliza quebras de linha, remove marcadores de página do pdf-parse e limita o tamanho. */
export function normalizeCvText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*-- \d+ of \d+ --\s*$/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CV_TEXT_CHARS);
}
