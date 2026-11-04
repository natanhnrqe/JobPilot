import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { AppError } from "../../src/domain/errors.js";
import { fetchJobPage, ipIsBlocked } from "../../src/fetch/safeFetch.js";

/** Servidor local de teste (loopback liberado SOMENTE via allowLoopbackForTests). */
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/vaga") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<html><head><title>Vaga</title></head><body><p>Descrição da vaga de estágio em Node.js com mais de trinta caracteres.</p></body></html>",
      );
      return;
    }
    if (url === "/redirect-privado") {
      res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
      return;
    }
    if (url === "/redirect-loop") {
      res.writeHead(302, { Location: "/redirect-loop" });
      res.end();
      return;
    }
    if (url === "/pdf") {
      res.writeHead(200, { "Content-Type": "application/pdf" });
      res.end("%PDF-1.4");
      return;
    }
    if (url === "/grande") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<p>" + "x".repeat(5000) + "</p>");
      return;
    }
    if (url === "/lento") {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<p>tarde demais</p>");
      }, 2000);
      return;
    }
    if (url === "/403") {
      res.writeHead(403, { "Content-Type": "text/html" });
      res.end("bloqueado");
      return;
    }
    if (url === "/404") {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("nao existe");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<p>ok</p>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const loopback = { allowLoopbackForTests: true } as const;

async function expectAppError(promise: Promise<unknown>, status: number, message: RegExp) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "era para falhar").toBeInstanceOf(AppError);
  const appErr = err as AppError;
  expect(appErr.status).toBe(status);
  expect(appErr.message).toMatch(message);
}

describe("SSRF — matriz de endereços (ipIsBlocked)", () => {
  it("permite endereços públicos", () => {
    expect(ipIsBlocked("8.8.8.8")).toBe(false);
    expect(ipIsBlocked("203.0.113.10")).toBe(false);
    expect(ipIsBlocked("2001:4860:4860::8888")).toBe(false);
  });

  it("bloqueia loopback, privados, link-local, CGNAT e metadata", () => {
    const blocked = [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "192.168.1.10",
      "169.254.169.254", // metadata cloud
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fd00::1",
      "::",
      "999.1.1.1",
    ];
    for (const ip of blocked) expect(ipIsBlocked(ip), ip).toBe(true);
  });

  it("com allowLoopbackForTests libera APENAS loopback (não privados/metadata)", () => {
    expect(ipIsBlocked("127.0.0.1", loopback)).toBe(false);
    expect(ipIsBlocked("::1", loopback)).toBe(false);
    expect(ipIsBlocked("192.168.1.10", loopback)).toBe(true);
    expect(ipIsBlocked("169.254.169.254", loopback)).toBe(true);
    expect(ipIsBlocked("10.1.1.1", loopback)).toBe(true);
  });
});

describe("fetchJobPage — proteções de entrada", () => {
  it("rejeita protocolos diferentes de http/https", async () => {
    await expectAppError(fetchJobPage("ftp://example.com/vaga"), 400, /http/);
    await expectAppError(fetchJobPage("file:///c:/Windows/win.ini"), 400, /http/);
    await expectAppError(fetchJobPage("javascript:alert(1)"), 400, /http|URL inválida/);
  });

  it("rejeita URL malformada", async () => {
    await expectAppError(fetchJobPage("nao-e-url"), 400, /URL inválida/);
  });

  it("bloqueia loopback, IP privado e metadata cloud SEM opção de teste", async () => {
    await expectAppError(fetchJobPage("http://127.0.0.1:3000/"), 400, /não permitido/);
    await expectAppError(fetchJobPage("http://192.168.0.10/vaga"), 400, /não permitido/);
    await expectAppError(
      fetchJobPage("http://169.254.169.254/latest/meta-data/"),
      400,
      /não permitido/,
    );
    await expectAppError(fetchJobPage("http://10.0.0.8/"), 400, /não permitido/);
  });

  it("bloqueia host que resolve para endereço interno (ex.: localhost)", async () => {
    await expectAppError(fetchJobPage("http://localhost:3000/"), 400, /não permitido/);
  });
});

describe("fetchJobPage — requisições (servidor local de teste)", () => {
  it("obtém HTML de destino público-simulado (loopback só em teste)", async () => {
    const page = await fetchJobPage(`${baseUrl}/vaga`, loopback);
    expect(page.contentType).toBe("text/html");
    expect(page.finalUrl).toContain("/vaga");
    expect(page.bytes).toBeGreaterThan(0);
    expect(page.content).toContain("estágio em Node.js");
  });

  it("BLOQUEIA redirecionamento para endereço interno (salto revalidado)", async () => {
    await expectAppError(
      fetchJobPage(`${baseUrl}/redirect-privado`, loopback),
      400,
      /não permitido/,
    );
  });

  it("encerra em erro após exceder o limite de redirecionamentos", async () => {
    await expectAppError(
      fetchJobPage(`${baseUrl}/redirect-loop`, loopback),
      508,
      /redirecionamento/i,
    );
  });

  it("rejeita tipo de conteúdo não aceito (PDF)", async () => {
    await expectAppError(fetchJobPage(`${baseUrl}/pdf`, loopback), 415, /conteúdo não suportado/i);
  });

  it("rejeita resposta maior que o limite", async () => {
    await expectAppError(
      fetchJobPage(`${baseUrl}/grande`, { ...loopback, maxBytes: 1000 }),
      413,
      /maior que o limite/,
    );
  });

  it("trata bloqueio 403 como proteção da página (orienta colar o texto)", async () => {
    await expectAppError(fetchJobPage(`${baseUrl}/403`, loopback), 422, /bloqueou o acesso/);
  });

  it("trata HTTP 404 como erro do servidor", async () => {
    await expectAppError(fetchJobPage(`${baseUrl}/404`, loopback), 502, /HTTP 404/);
  });

  it("respeita o tempo limite de resposta", async () => {
    await expectAppError(
      fetchJobPage(`${baseUrl}/lento`, { ...loopback, timeoutMs: 300 }),
      502,
      /300 ms/,
    );
  }, 10000);
});
