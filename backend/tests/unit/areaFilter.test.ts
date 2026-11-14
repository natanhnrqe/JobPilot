import { describe, expect, it } from "vitest";
import {
  MAX_AREA_KEYWORDS,
  matchesArea,
  normalizeAreaKeywords,
  tokenize,
} from "../../src/domain/areaFilter.js";

describe("filtro por área — normalização", () => {
  it("remove vazios, normaliza espaços e deduplica sem diferenciar caixa/acento", () => {
    expect(
      normalizeAreaKeywords([
        "  Desenvolvimento  ",
        "desenvolvimento",
        "Front-end",
        "front end",
        "   ",
        "Java",
      ]),
    ).toEqual(["Desenvolvimento", "Front-end", "Java"]);
  });

  it("limita a quantidade de palavras-chave", () => {
    const values = Array.from({ length: MAX_AREA_KEYWORDS + 5 }, (_, i) => `area-${i}`);
    expect(normalizeAreaKeywords(values)).toHaveLength(MAX_AREA_KEYWORDS);
  });

  it("tokeniza sem acento, caixa ou pontuação", () => {
    expect(tokenize("Estágio em Front-end/React.js")).toEqual([
      "estagio",
      "em",
      "front",
      "end",
      "react",
      "js",
    ]);
  });
});

describe("filtro por área — correspondência", () => {
  it("lista vazia não filtra (comportamento anterior preservado)", () => {
    expect(matchesArea("Estágio em Marketing", "Redes sociais", [])).toBe(true);
  });

  it("encontra a palavra no título, sem diferenciar acento ou caixa", () => {
    expect(matchesArea("ESTÁGIO EM DESENVOLVIMENTO", "", ["desenvolvimento"])).toBe(true);
  });

  it("encontra a palavra na descrição", () => {
    expect(matchesArea("Estágio em Tecnologia", "Requisitos: Java e Spring Boot.", ["java"])).toBe(
      true,
    );
  });

  it("aceita frases com mais de uma palavra", () => {
    expect(
      matchesArea("Estágio em Dados", "Usamos Spring Boot no dia a dia.", ["spring boot"]),
    ).toBe(true);
  });

  it("trata Front-end e frontend como equivalentes", () => {
    expect(matchesArea("Estágio Front-end", "", ["frontend"])).toBe(true);
    expect(matchesArea("Estágio Frontend", "", ["front-end"])).toBe(true);
  });

  it("não confunde palavras curtas com pedaços de outras", () => {
    expect(matchesArea("Estágio em TI", "", ["ti"])).toBe(true);
    expect(matchesArea("Estágio em Time de Vendas", "", ["ti"])).toBe(false);
    expect(matchesArea("Analista de Capital", "", ["api"])).toBe(false);
    expect(matchesArea("Estágio em APIs REST", "", ["api"])).toBe(true);
  });

  it("aceita prefixo em palavras longas (desenvolv → desenvolvimento)", () => {
    expect(matchesArea("Estágio em Desenvolvimento", "", ["desenvolv"])).toBe(true);
  });

  it("filtra quando nenhuma palavra-chave aparece", () => {
    expect(
      matchesArea("Estágio em Marketing", "Redes sociais e campanhas.", ["backend", "java"]),
    ).toBe(false);
  });

  it("não usa palavras genéricas da descrição para aprovar vagas de outra área", () => {
    expect(
      matchesArea("Estágio em SDR", "Desenvolvimento de habilidades comerciais.", [
        "desenvolvimento",
      ]),
    ).toBe(false);
    expect(
      matchesArea("Estagiário de Logística", "Conhecimento em sistemas ERP.", ["sistemas"]),
    ).toBe(false);
    expect(
      matchesArea("Estágio em Administração", "Conhecimento em software de gestão.", ["software"]),
    ).toBe(false);
  });

  it("não confunde REST com restaurantes", () => {
    expect(matchesArea("Auxiliar administrativo", "Parceria com restaurantes.", ["rest"])).toBe(
      false,
    );
    expect(matchesArea("Estágio em APIs REST", "", ["rest"])).toBe(true);
  });

  it("aceita tecnologia específica na descrição", () => {
    expect(matchesArea("Estágio em Tecnologia", "Requisitos: Python e Docker.", ["python"])).toBe(
      true,
    );
  });

  it("aceita termos de título como tech, AI e suporte técnico", () => {
    expect(matchesArea("Estágio EBANX Early Talent - TECH EDITION", "", ["tech"])).toBe(true);
    expect(matchesArea("AI Engineer", "", ["ai"])).toBe(true);
    expect(matchesArea("Estágio em Suporte Técnico", "", ["suporte técnico"])).toBe(true);
  });

  it("não usa 'ai' da descrição (interjeição) para aprovar vaga", () => {
    expect(matchesArea("Estágio em Marketing", "Ai de você se perder o prazo.", ["ai"])).toBe(
      false,
    );
  });
});
