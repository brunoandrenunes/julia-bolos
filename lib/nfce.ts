import jsQR from "jsqr";
import { extractImages, getDocumentProxy } from "unpdf";
import { dbHelpers, withDatabase } from "@/lib/db";
import { parseNfceInput, parseNfcePrHtml, productKey, type Nfce } from "@/lib/nfce-parse";
import { normalizeText } from "@/lib/utils";

/* ===================================================================
   Importar compra pelo cupom (NFC-e do Paraná)
   O QR Code do cupom leva à página pública da Fazenda com os itens.
   O sistema lê a página, reconhece o mercado pelo CNPJ e sugere o que
   fazer com cada produto (o que foi escolhido da última vez, ou um palpite
   pelo nome). Nada é gravado aqui: a compra só é registrada no formulário.
   =================================================================== */

const { queryAll, queryOne } = dbHelpers;
const num = (value: unknown) => Number(value || 0);

export type InvoiceLineDraft = {
  source: { key: string; description: string; code: string; qty: number; unit: string; unitPrice: number; total: number };
  destination: "inventory" | "financial" | "personal" | "skip";
  itemId: number | null;
  movementTypeId: number | null;
  description: string;
  quantity: number;
  origin: "aprendido" | "palpite" | null;
};

export type InvoiceDraft = {
  key: string;
  supplierId: number | null;
  supplierName: string;
  supplierDocument: string;
  date: string | null;
  paymentMethodId: number | null;
  paymentLabel: string;
  invoiceNumber: string;
  total: number;
  duplicate: { id: number; date: string } | null;
  lines: InvoiceLineDraft[];
};

// Lê o QR Code de um PDF escaneado (foto do cupom salva em PDF).
async function qrFromPdf(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes.slice());
  for (let page = 1; page <= Math.min(pdf.numPages, 3); page += 1) {
    for (const img of await extractImages(pdf, page)) {
      for (const step of [2, 1, 3, 4]) {
        const w = Math.floor(img.width / step);
        const h = Math.floor(img.height / step);
        if (w < 100 || h < 100) continue;
        const rgba = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y += 1) {
          for (let x = 0; x < w; x += 1) {
            const i = (y * step * img.width + x * step) * img.channels;
            const gray = img.channels >= 3 ? (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3 : img.data[i];
            const o = (y * w + x) * 4;
            rgba[o] = rgba[o + 1] = rgba[o + 2] = gray;
            rgba[o + 3] = 255;
          }
        }
        const found = jsQR(rgba, w, h, { inversionAttempts: "attemptBoth" });
        if (found?.data) return found.data;
      }
    }
  }
  return null;
}

async function fetchNfce(url: string): Promise<Nfce> {
  const parsed = new URL(url);
  // Só a página oficial da Fazenda do Paraná (evita o sistema buscar endereços estranhos).
  if (!/(^|\.)fazenda\.pr\.gov\.br$/i.test(parsed.hostname) || !/\/nfce\/qrcode/i.test(parsed.pathname)) {
    throw new Error("O link não é de um cupom da Fazenda do Paraná.");
  }
  parsed.protocol = "https:";
  const response = await fetch(parsed.toString(), {
    headers: { "User-Agent": "Mozilla/5.0 (sistema Julia Ronsoni Bolos)" },
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`A Fazenda não respondeu (erro ${response.status}). Tente de novo em alguns minutos.`);
  const html = new TextDecoder("utf-8").decode(await response.arrayBuffer());
  const nfce = parseNfcePrHtml(html);
  if (!nfce.items.length) {
    throw new Error("A Fazenda não devolveu os itens deste cupom. Se ele é de hoje, pode levar alguns minutos para aparecer.");
  }
  return nfce;
}

// Palpite pelo nome: palavras em comum entre o produto da nota e o item do sistema.
function guessItem(description: string, items: { id: number; name: string }[]) {
  const words = (text: string) =>
    normalizeText(text)
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 2)
      .map((word) => (word.length > 3 ? word.replace(/s$/, "") : word));
  const target = words(description);
  if (!target.length) return null;
  const scored = items
    .map((item) => {
      const name = words(item.name.split(" - ")[0]);
      const hits = name.filter((word) => target.includes(word)).length;
      return { item, hits, first: name[0] === target[0], extra: name.length - hits };
    })
    .filter((row) => row.first && row.hits >= 1)
    .sort((a, b) => b.hits - a.hits || a.extra - b.extra);
  if (!scored.length || (scored[1] && scored[1].hits === scored[0].hits && scored[1].extra === scored[0].extra)) return null;
  return scored[0].item;
}

export async function readInvoice(input: { text?: string; pdf?: Uint8Array }): Promise<InvoiceDraft> {
  let text = input.text?.trim() || "";
  if (input.pdf) {
    const decoded = await qrFromPdf(input.pdf);
    if (!decoded) throw new Error("Não consegui ler o QR Code neste arquivo. Tente uma foto mais nítida ou cole o link do QR Code.");
    text = decoded;
  }
  const { url, key } = parseNfceInput(text);
  if (!url) {
    if (key && !key.startsWith("41")) throw new Error("Por enquanto o sistema lê cupons do Paraná.");
    if (key && key.slice(20, 22) === "55") {
      throw new Error("Esta chave é de uma NF-e (nota de fornecedor). Por enquanto, a leitura automática é do cupom de mercado (NFC-e).");
    }
    throw new Error("Para cupom de mercado é preciso o QR Code (foto, PDF escaneado ou o link). Só a chave a Fazenda não libera os itens.");
  }
  const nfce = await fetchNfce(url);

  return withDatabase(async (db) => {
    const [supplier, duplicate, links, items, types, payments] = await Promise.all([
      queryOne(db, "SELECT id, name FROM suppliers WHERE document = ? ORDER BY is_active DESC, id LIMIT 1", [nfce.document]),
      queryOne(db, "SELECT id, purchase_date FROM purchases WHERE access_key = ?", [nfce.key || key]),
      queryAll(db, "SELECT * FROM invoice_product_links WHERE supplier_document = ?", [nfce.document]),
      queryAll(db, "SELECT id, name FROM items WHERE is_active = 1"),
      queryAll(db, "SELECT id, name FROM movement_types WHERE name IN ('Insumos', 'Retirada')"),
      queryAll(db, "SELECT id, name FROM payment_methods"),
    ]);
    const typeId = (name: string) => num(types.find((row) => row.name === name)?.id) || null;
    const byKey = new Map(links.map((row) => [String(row.product_key), row]));
    const itemList = items.map((row) => ({ id: num(row.id), name: String(row.name) }));

    // Forma de pagamento: a maior da nota. Débito e Pix saem da conta (Pix/Nubank).
    const main = [...nfce.payments].sort((a, b) => b.amount - a.amount)[0];
    const method = normalizeText(main?.method || "");
    const paymentName = /credito/.test(method) ? "Cartão Crédito" : /dinheiro/.test(method) ? "Dinheiro" : /pix|instant|debito/.test(method) ? "Pix" : "";
    const payment = payments.find((row) => row.name === paymentName);

    // Junta linhas repetidas do mesmo produto e preço (ex.: 2× Leite Ninho).
    const merged: Nfce["items"] = [];
    nfce.items.forEach((item) => {
      const same = merged.find((row) => row.code === item.code && row.description === item.description && Math.abs(row.unitPrice - item.unitPrice) < 0.005);
      if (same) {
        same.qty = Math.round((same.qty + item.qty) * 1000) / 1000;
        same.total = Math.round((same.total + item.total) * 100) / 100;
      } else merged.push({ ...item });
    });

    const lines: InvoiceLineDraft[] = merged.map((item) => {
      const sourceKey = productKey(item);
      const source = { key: sourceKey, ...item };
      const link = byKey.get(sourceKey);
      if (link) {
        const destination = String(link.destination) as InvoiceLineDraft["destination"];
        return {
          source,
          destination,
          itemId: link.item_id == null ? null : num(link.item_id),
          movementTypeId: link.movement_type_id == null ? (destination === "personal" ? typeId("Retirada") : typeId("Insumos")) : num(link.movement_type_id),
          description: String(link.financial_description || item.description),
          quantity: destination === "inventory" ? Math.round(item.qty * num(link.qty_factor) * 1000) / 1000 : item.qty,
          origin: "aprendido",
        };
      }
      const guess = guessItem(item.description, itemList);
      // "Dz" (dúzia) para item contado por unidade: 12 por dúzia.
      const dozen = guess && /\bdz\b|duzia/i.test(normalizeText(item.description)) && /unidade/i.test(guess.name);
      return {
        source,
        destination: guess ? "inventory" : "financial",
        itemId: guess?.id ?? null,
        movementTypeId: typeId("Insumos"),
        description: item.description,
        quantity: dozen ? item.qty * 12 : item.qty,
        origin: guess ? "palpite" : null,
      };
    });

    return {
      key: nfce.key || key || "",
      supplierId: supplier ? num(supplier.id) : null,
      supplierName: nfce.supplierName,
      supplierDocument: nfce.document,
      date: nfce.emission,
      paymentMethodId: payment ? num(payment.id) : null,
      paymentLabel: main?.method || "",
      invoiceNumber: nfce.number ? `${nfce.number}${nfce.series ? `/${nfce.series}` : ""}` : "",
      total: nfce.total,
      duplicate: duplicate ? { id: num(duplicate.id), date: String(duplicate.purchase_date) } : null,
      lines,
    };
  });
}
