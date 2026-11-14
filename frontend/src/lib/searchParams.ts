/**
 * Atualiza um filtro na URL preservando a paginação apenas quando o próprio
 * botão de página é acionado. Qualquer outro filtro volta para a página 1.
 */
export function updateFilterParams(
  current: URLSearchParams,
  key: string,
  value: string,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (value === "") next.delete(key);
  else next.set(key, value);
  if (key !== "page") next.delete("page");
  return next;
}
