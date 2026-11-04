import { describe, expect, it } from "vitest";
import { extractTitleTag, htmlToText } from "../../src/fetch/htmlText.js";

describe("htmlToText — conversão segura de HTML em texto", () => {
  it("remove scripts, estilos e comentários (nunca vão para o prompt)", () => {
    const html = `
      <html><head><title>Estágio Node.js</title>
      <style>.x{color:red}</style>
      <script>alert("injection")</script></head>
      <body><!-- comentario --><p>Vaga de estágio em Node.js</p></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("Vaga de estágio em Node.js");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("comentario");
  });

  it("preserva a estrutura básica (títulos, listas e parágrafos)", () => {
    const html = "<h1>Cargo</h1><p>Descrição</p><ul><li>Requisito 1</li><li>Requisito 2</li></ul>";
    const text = htmlToText(html);
    expect(text).toContain("## Cargo");
    expect(text).toContain("- Requisito 1");
    expect(text).toContain("- Requisito 2");
    expect(text).toContain("Descrição");
  });

  it("decodifica entidades HTML comuns", () => {
    expect(htmlToText("<p>R&amp;D &quot;vaga&quot; &#39;x&#39;&nbsp;y</p>")).toBe(
      "R&D \"vaga\" 'x' y",
    );
    expect(htmlToText("<p>a &lt; b</p>")).toBe("a < b");
  });

  it("não deixa nenhuma tag residual no texto", () => {
    const text = htmlToText('<div><span class="a">Olá</span><br><img src="x"></div>');
    expect(text).toBe("Olá");
    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
  });

  it("extractTitleTag lê <title> e devolve null quando ausente", () => {
    expect(extractTitleTag("<html><head><title> Vaga X </title></head></html>")).toBe("Vaga X");
    expect(extractTitleTag("<html><body>sem titulo</body></html>")).toBeNull();
  });
});
