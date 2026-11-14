import { describe, expect, it } from "vitest";
import { updateFilterParams } from "../../../frontend/src/lib/searchParams.js";

/**
 * Regressão do bug de paginação: mudar de página precisa PRESERVAR `page`.
 * Os demais filtros continuam voltando para a página 1.
 */
describe("updateFilterParams — paginação da lista de vagas", () => {
  it("ao mudar de página, mantém o número e os outros filtros", () => {
    const current = new URLSearchParams("status=new&page=1");
    const next = updateFilterParams(current, "page", "2");

    expect(next.get("page")).toBe("2");
    expect(next.get("status")).toBe("new");
  });

  it("ao mudar qualquer outro filtro, volta para a página 1", () => {
    const current = new URLSearchParams("status=new&page=3");
    const next = updateFilterParams(current, "status", "prioritized");

    expect(next.get("status")).toBe("prioritized");
    expect(next.has("page")).toBe(false);
  });

  it("valor vazio remove o filtro e também reinicia a página", () => {
    const current = new URLSearchParams("q=java&page=2");
    const next = updateFilterParams(current, "q", "");

    expect(next.has("q")).toBe(false);
    expect(next.has("page")).toBe(false);
  });

  it("não altera o objeto de parâmetros original", () => {
    const current = new URLSearchParams("page=1");
    updateFilterParams(current, "page", "2");

    expect(current.get("page")).toBe("1");
  });
});
