import { describe, expect, it } from "vitest";
import { toCsv } from "../../src/domain/csv.js";

describe("toCsv", () => {
  it("gera cabeçalho e linhas com CRLF", () => {
    const csv = toCsv(
      ["id", "nome"],
      [
        [1, "Ana"],
        [2, "Bia"],
      ],
    );
    expect(csv).toBe("id,nome\r\n1,Ana\r\n2,Bia\r\n");
  });

  it("escapa vírgula, aspas e quebra de linha", () => {
    const csv = toCsv(["campo"], [["a,b"], ['diz "oi"'], ["linha1\nlinha2"]]);
    expect(csv).toBe('campo\r\n"a,b"\r\n"diz ""oi"""\r\n"linha1\nlinha2"\r\n');
  });

  it("converte nulos e indefinidos em campo vazio", () => {
    expect(toCsv(["a", "b"], [[null, undefined]])).toBe("a,b\r\n,\r\n");
  });

  it("neutraliza fórmulas de planilha", () => {
    const csv = toCsv(["valor"], [['=HYPERLINK("http://x")'], ["+1"], ["-1"], ["@cmd"]]);
    expect(csv).toBe('valor\r\n"\'=HYPERLINK(""http://x"")"\r\n\'+1\r\n\'-1\r\n\'@cmd\r\n');
  });
});
