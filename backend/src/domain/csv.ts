/**
 * Serialização CSV simples e segura (RFC 4180).
 *
 * - campos com vírgula, aspas ou quebra de linha são escapados com aspas;
 * - campos iniciados por `=`, `+`, `-`, `@`, tab ou CR recebem um apóstrofo
 *   para evitar injeção de fórmula ao abrir o arquivo no Excel/LibreOffice;
 * - valores nulos viram campo vazio.
 */

export type CsvValue = string | number | boolean | null | undefined;

function escapeField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text = String(value);

  // Mitigação de CSV/formula injection (OWASP): não deixar o campo começar
  // com um caractere que a planilha interpretaria como fórmula.
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(escapeField).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeField).join(","));
  }
  // CRLF é o padrão RFC 4180 e abre corretamente no Excel.
  return `${lines.join("\r\n")}\r\n`;
}
