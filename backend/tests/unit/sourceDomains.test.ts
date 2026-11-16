import { describe, expect, it } from "vitest";
import {
  BLOCKED_SOURCE_DOMAINS,
  hostnameOf,
  isBlockedSourceUrl,
} from "../../src/domain/sourceDomains.js";

/**
 * Blocklist de domínios de agregadores de baixa qualidade. A regra é por
 * sufixo: o domínio e qualquer subdomínio ficam bloqueados; domínios
 * parecidos (prefixo/sufixo diferente) continuam liberados.
 */

describe("isBlockedSourceUrl", () => {
  it("bloqueia o domínio e seus subdomínios", () => {
    expect(isBlockedSourceUrl("https://dedyn.io/vaga/1")).toBe(true);
    expect(isBlockedSourceUrl("https://us.remotejobs.dedyn.io/job/1")).toBe(true);
    expect(isBlockedSourceUrl("http://a.b.dedyn.io/vaga")).toBe(true);
  });

  it("ignora caixa e ponto final no host", () => {
    expect(isBlockedSourceUrl("https://US.RemoteJobs.DEDYN.IO./job/1")).toBe(true);
  });

  it("não bloqueia domínio parecido que não é subdomínio", () => {
    expect(isBlockedSourceUrl("https://notdedyn.io/vaga")).toBe(false);
    expect(isBlockedSourceUrl("https://dedyn.io.evil.com/vaga")).toBe(false);
    expect(isBlockedSourceUrl("https://dedyn.io.br/vaga")).toBe(false);
  });

  it("não bloqueia as fontes e portais já verificados", () => {
    expect(isBlockedSourceUrl("https://br.linkedin.com/jobs/view/1")).toBe(false);
    expect(isBlockedSourceUrl("https://www.nube.com.br/vagas/1")).toBe(false);
    expect(isBlockedSourceUrl("https://remoteok.com/remote-jobs/1")).toBe(false);
    expect(isBlockedSourceUrl("https://br.trabajo.org/emprego-1")).toBe(false);
  });

  it("URL inválida não é bloqueada (vira 'invalid' no fluxo de coleta)", () => {
    expect(isBlockedSourceUrl("")).toBe(false);
    expect(isBlockedSourceUrl("nao-e-url")).toBe(false);
    expect(isBlockedSourceUrl("ftp://dedyn.io/vaga")).toBe(false);
  });

  it("expõe a lista para documentação e testes", () => {
    expect(BLOCKED_SOURCE_DOMAINS).toContain("dedyn.io");
  });
});

describe("hostnameOf", () => {
  it("devolve o host minúsculo", () => {
    expect(hostnameOf("https://US.RemoteJobs.Dedyn.IO/job/1")).toBe("us.remotejobs.dedyn.io");
  });

  it("devolve null para URL inválida", () => {
    expect(hostnameOf("nao-e-url")).toBeNull();
  });
});
