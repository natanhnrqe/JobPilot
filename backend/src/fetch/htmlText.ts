/**
 * Conversão mínima de HTML para texto plano (sem dependências externas e
 * sem executar qualquer JavaScript da página). O resultado é DADO NÃO
 * CONFIÁVEL: vai sempre delimitado no prompt (ai/prompts.ts).
 */

const BLOCK_TAGS =
  /<\/?(p|div|br|li|ul|ol|tr|td|th|section|article|header|footer|h[1-6]|table|blockquote)\b[^>]*>/gi;

export function htmlToText(html: string): string {
  let text = html;

  // Remove scripts, estilos, comentários e declarações — nunca entram no prompt.
  text = text.replace(/<script\b[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<template\b[\s\S]*?<\/template>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  // Títulos ganham separação para preservar estrutura mínima.
  text = text.replace(/<h([1-6])\b[^>]*>/gi, "\n\n## ");
  text = text.replace(/<\/h[1-6]>/gi, "\n\n");
  text = text.replace(/<li\b[^>]*>/gi, "\n- ");
  text = text.replace(BLOCK_TAGS, "\n");

  // Entidades HTML comuns (nomes montados por concatenação para permanecerem literais no código).
  const AMP = "&" + "amp;";
  const LT = "&" + "lt;";
  const GT = "&" + "gt;";
  const QUOT = "&" + "quot;";
  const APOS = "&" + "#39;";
  const NBSP = "&" + "nbsp;";
  text = text
    .replace(new RegExp(NBSP, "gi"), " ")
    .replace(new RegExp(LT, "gi"), "<")
    .replace(new RegExp(GT, "gi"), ">")
    .replace(new RegExp(QUOT, "gi"), '"')
    .replace(new RegExp(APOS, "gi"), "'")
    .replace(new RegExp(AMP, "gi"), "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));

  // Remove qualquer tag restante (defesa em profundidade).
  text = text.replace(/<[^>]+>/g, " ");

  // Colapsa espaços e linhas vazias excessivas.
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

/** Extrai o conteúdo dentro de <title> para sugestão de depuração (não vai para o prompt). */
export function extractTitleTag(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  return htmlToText(match[1] ?? "").slice(0, 300) || null;
}
