import { describe, expect, it } from "vitest";
import { detectPortal, UNKNOWN_PORTAL } from "../../src/domain/portals.js";

describe("detectPortal", () => {
  it("identifica os portais-alvo, inclusive em subdomínios", () => {
    expect(detectPortal("https://portal.gupy.io/job/123").key).toBe("gupy");
    expect(detectPortal("https://www.linkedin.com/jobs/view/1").key).toBe("linkedin");
    expect(detectPortal("https://br.indeed.com/viewjob?jk=1").key).toBe("indeed");
    expect(detectPortal("https://www.glassdoor.com.br/vaga/1").key).toBe("glassdoor");
  });

  it("trata todos os portais como envio manual (sem automação)", () => {
    const urls = [
      "https://portal.gupy.io/job/1",
      "https://www.linkedin.com/jobs/view/1",
      "https://br.indeed.com/viewjob?jk=1",
      "https://www.glassdoor.com.br/vaga/1",
      "https://boards.greenhouse.io/acme/jobs/1",
      "https://jobs.lever.co/acme/1",
      "https://jobs.ashbyhq.com/acme/1",
      "https://remotive.com/remote-jobs/1",
      "https://remoteok.com/remote-jobs/1",
    ];
    for (const url of urls) {
      const portal = detectPortal(url);
      expect(portal.manualOnly).toBe(true);
      expect(portal.note.length).toBeGreaterThan(0);
    }
  });

  it("devolve o portal genérico para URL desconhecida, inválida ou ausente", () => {
    expect(detectPortal("https://exemplo.com/vaga")).toEqual(UNKNOWN_PORTAL);
    expect(detectPortal("nao-e-url")).toEqual(UNKNOWN_PORTAL);
    expect(detectPortal(null)).toEqual(UNKNOWN_PORTAL);
  });

  it("não confunde domínios parecidos", () => {
    expect(detectPortal("https://notlinkedin.com/vaga").key).toBe("other");
    expect(detectPortal("https://linkedin.com.evil.com/vaga").key).toBe("other");
  });
});
