import { getDocumentProxy } from "unpdf";
import { parseNubankCsv, parseNubankPdf, parseOfx, type ParsedStatement, type PdfTextItem } from "@/lib/extrato-parse";

// Descobre o tipo do arquivo (PDF, OFX ou CSV) e devolve as linhas do extrato.
export async function readStatementFile(bytes: Uint8Array, fileName = ""): Promise<ParsedStatement> {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 5));
  if (head.startsWith("%PDF")) {
    const pdf = await getDocumentProxy(bytes.slice()); // cópia: o leitor de PDF consome o arquivo
    const pages: PdfTextItem[][] = [];
    for (let p = 1; p <= pdf.numPages; p += 1) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item)
          .map((item) => ({ str: item.str, x: item.transform[4], y: item.transform[5] })),
      );
    }
    const parsed = parseNubankPdf(pages);
    if (!parsed.lines.length) throw new Error("Não encontrei movimentações neste PDF. Ele é o extrato da conta Nubank?");
    return parsed;
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  if (/<OFX>/i.test(text) || fileName.toLowerCase().endsWith(".ofx")) return parseOfx(text);
  if (fileName.toLowerCase().endsWith(".csv") || /^﻿?data,/i.test(text)) return parseNubankCsv(text);
  throw new Error("Formato não reconhecido. Envie o extrato em PDF, OFX ou CSV.");
}
