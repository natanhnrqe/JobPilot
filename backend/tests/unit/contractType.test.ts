import { describe, expect, it } from "vitest";
import { inferContractTypeFromTitle } from "../../src/domain/contractType.js";

describe("inferContractTypeFromTitle — classificação conservadora pelo título", () => {
  it("reconhece estágio em português e inglês", () => {
    expect(inferContractTypeFromTitle("Estágio em Backend")).toBe("internship");
    expect(inferContractTypeFromTitle("Estagiário(a) de Dados")).toBe("internship");
    expect(inferContractTypeFromTitle("Estágios 2026 — Desenvolvimento")).toBe("internship");
    expect(inferContractTypeFromTitle("Software Engineering Intern")).toBe("internship");
    expect(inferContractTypeFromTitle("Backend Internship")).toBe("internship");
  });

  it("reconhece júnior/trainee", () => {
    expect(inferContractTypeFromTitle("Desenvolvedor Júnior")).toBe("junior");
    expect(inferContractTypeFromTitle("Pessoa Desenvolvedora Junior")).toBe("junior");
    expect(inferContractTypeFromTitle("Jr. Developer")).toBe("junior");
    expect(inferContractTypeFromTitle("Trainee de QA")).toBe("junior");
    expect(inferContractTypeFromTitle("Entry-Level Engineer")).toBe("junior");
  });

  it("reconhece freelance, pleno e sênior", () => {
    expect(inferContractTypeFromTitle("Freelance React Developer")).toBe("freelance");
    expect(inferContractTypeFromTitle("Pessoa Desenvolvedora Pleno")).toBe("mid");
    expect(inferContractTypeFromTitle("Senior Backend Engineer")).toBe("senior");
    expect(inferContractTypeFromTitle("Tech Lead")).toBe("senior");
    expect(inferContractTypeFromTitle("Engineering Manager")).toBe("senior");
  });

  it("devolve null quando não há marcador claro (não inventa nível)", () => {
    expect(inferContractTypeFromTitle("Product Designer")).toBeNull();
    expect(inferContractTypeFromTitle("Backend Engineer")).toBeNull();
    expect(inferContractTypeFromTitle("")).toBeNull();
    expect(inferContractTypeFromTitle("   ")).toBeNull();
  });

  it("não confunde 'intern' com 'internal'/'international'", () => {
    expect(inferContractTypeFromTitle("Internal Tools Engineer")).toBeNull();
    expect(inferContractTypeFromTitle("International Sales Representative")).toBeNull();
  });

  it("não confunde 'lead' com palavras que apenas o contêm", () => {
    expect(inferContractTypeFromTitle("Leadership Program")).toBeNull();
  });
});
