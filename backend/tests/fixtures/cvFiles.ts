/**
 * Arquivos de CV gerados em memória para os testes OFFLINE.
 *
 * - PDF: montado com uma tabela xref válida (sem dependência externa).
 * - DOCX: ZIP mínimo pré-gerado e embutido em base64 (sem escrever no disco).
 */

/** Gera um PDF de uma página com o texto informado (ASCII/WinAnsi). */
export function makePdf(text: string): Buffer {
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const escaped = text.replace(/[()\\]/g, "\\$&");
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

/** DOCX mínimo com duas linhas de currículo. */
export const DOCX_BASE64 =
  "UEsDBAoAAAAIALSzZl3XeYTq8QAAALgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE730Ky9cqccoBIZSkB36OwKE8wMreJFb9J69b2rdn00KREOVozXwz62nXB+/EHjPZGDq5qhspMOhobBg7+b55ru6koALBgIsBO3lEkut+0W6OCUkwHKiTUynpXinSE3qgOiYMrAwxeyj8zKNKoLcworppmlulYygYSlXmDNkvhGgfcYCdK+LpwMr5loyOpHg4e+e6TkJKzmoorKt9ML+Kqq+SmsmThyabaMkGqa6VzOL1jh/0lSfK1qB4g1xewLNRfcRslIl65xmu/0/649o4DFbjhZ/TUo4aiXh77+qL4sGG71+06jR8/wlQSwMECgAAAAAAtLNmXQAAAAAAAAAAAAAAAAYAAABfcmVscy9QSwMECgAAAAgAtLNmXSAbhuqyAAAALgEAAAsAAABfcmVscy8ucmVsc43Puw6CMBQG4J2naM4uBQdjDIXFmLAafICmPZRGeklbL7y9HRzEODie23fyN93TzOSOIWpnGdRlBQStcFJbxeAynDZ7IDFxK/nsLDJYMELXFs0ZZ57yTZy0jyQjNjKYUvIHSqOY0PBYOo82T0YXDE+5DIp6Lq5cId1W1Y6GTwPagpAVS3rJIPSyBjIsHv/h3ThqgUcnbgZt+vHlayPLPChMDB4uSCrf7TKzQHNKuorZvgBQSwMECgAAAAAAtLNmXQAAAAAAAAAAAAAAAAUAAAB3b3JkL1BLAwQKAAAACAC0s2ZdP7o6ndoAAAA+AQAAEQAAAHdvcmQvZG9jdW1lbnQueG1sbY9BSwMxEIXv/RVDzrbZehBZdrdYVBAUKtUfMN2M3cBmJiSp2/XXm1S89fLxhhnevNdszm6EbwrRCrdqvaoUEPdiLB9b9fnxvLxXEBOywVGYWjVTVJtu0Uy1kf7kiBNkB4711KohJV9rHfuBHMaVeOK8+5LgMOUxHPUkwfggPcWYH7hR31bVnXZoWXULgOx6EDMXeRl8lxEKUveGwSLs5fSDsIQHxtHmXGAIHtFIbHQ5KgwX+qsmT2dPweaCFmvYzWkQvoH9+ysQ7GSiANuXq0ZF/CUr6r959wtQSwECFAAKAAAACAC0s2Zd13mE6vEAAAC4AQAAEwAAAAAAAAAAAAAAAAAAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAAoAAAAAALSzZl0AAAAAAAAAAAAAAAAGAAAAAAAAAAAAEAAAACIBAABfcmVscy9QSwECFAAKAAAACAC0s2ZdIBuG6rIAAAAuAQAACwAAAAAAAAAAAAAAAABGAQAAX3JlbHMvLnJlbHNQSwECFAAKAAAAAAC0s2ZdAAAAAAAAAAAAAAAABQAAAAAAAAAAABAAAAAhAgAAd29yZC9QSwECFAAKAAAACAC0s2ZdP7o6ndoAAAA+AQAAEQAAAAAAAAAAAAAAAABEAgAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAUABQAgAQAATQMAAAAA";

export function makeDocx(): Buffer {
  return Buffer.from(DOCX_BASE64, "base64");
}
