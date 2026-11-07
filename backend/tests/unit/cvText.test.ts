import { describe, expect, it } from "vitest";
import { MAX_CV_FILE_BYTES, extractCvText, normalizeCvText } from "../../src/services/cvText.js";
import { makeDocx, makePdf } from "../fixtures/cvFiles.js";

describe("extractCvText", () => {
  it("extrai texto de um PDF válido e remove o marcador de página", async () => {
    const result = await extractCvText({
      fileName: "curriculo.pdf",
      content: makePdf("Joao Silva - Desenvolvedor Backend - Node.js"),
    });

    expect(result.format).toBe("pdf");
    expect(result.text).toContain("Joao Silva");
    expect(result.text).toContain("Node.js");
    expect(result.text).not.toContain("-- 1 of 1 --");
  });

  it("extrai texto de um DOCX válido", async () => {
    const result = await extractCvText({
      fileName: "curriculo.docx",
      content: makeDocx(),
    });

    expect(result.format).toBe("docx");
    expect(result.text).toContain("Maria Souza");
    expect(result.text).toContain("Python");
  });

  it("aceita TXT e normaliza quebras de linha", async () => {
    const result = await extractCvText({
      fileName: "curriculo.txt",
      content: Buffer.from("Ana Lima\r\n\r\nExperiencia: SQL e APIs\r\n"),
    });

    expect(result.format).toBe("txt");
    expect(result.text).toBe("Ana Lima\n\nExperiencia: SQL e APIs");
  });

  it("recusa .doc antigo com orientação para converter", async () => {
    await expect(
      extractCvText({
        fileName: "curriculo.doc",
        content: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x01]),
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
      message: expect.stringContaining("PDF ou DOCX"),
    });
  });

  it("recusa formato não suportado", async () => {
    await expect(
      extractCvText({ fileName: "curriculo.rtf", content: Buffer.from("{\\rtf1 texto}") }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
  });

  it("recusa arquivo vazio", async () => {
    await expect(
      extractCvText({ fileName: "curriculo.pdf", content: Buffer.alloc(0) }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
  });

  it("recusa arquivo acima do limite", async () => {
    await expect(
      extractCvText({
        fileName: "curriculo.pdf",
        content: Buffer.alloc(MAX_CV_FILE_BYTES + 1),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
  });

  it("recusa PDF sem texto suficiente (digitalizado)", async () => {
    await expect(
      extractCvText({ fileName: "curriculo.pdf", content: makePdf("") }),
    ).rejects.toMatchObject({ code: "CV_ERROR", status: 422 });
  });
});

describe("normalizeCvText", () => {
  it("remove marcadores de página e espaços à direita", () => {
    expect(normalizeCvText("Linha 1  \r\n\r\n-- 1 of 2 --\r\nLinha 2")).toBe("Linha 1\n\nLinha 2");
  });
});
