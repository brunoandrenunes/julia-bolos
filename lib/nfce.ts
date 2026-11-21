import jsQR from "jsqr";
import { extractImages, getDocumentProxy } from "unpdf";
import { dbHelpers, withDatabase, withTransaction } from "@/lib/db";
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
  hint: string | null;
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
// Empate (ex.: Leite em Pó 350 g × 380 g) devolve os candidatos para desempatar pelo preço.
function guessItem(description: string, items: { id: number; name: string }[]) {
  const words = (text: string) =>
    normalizeText(text)
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 2)
      .map((word) => (word.length > 3 ? word.replace(/s$/, "") : word));
  const target = words(description);
  if (!target.length) return { item: null, candidates: [] as { id: number; name: string }[] };
  const scored = items
    .map((item) => {
      const name = words(item.name.split(" - ")[0]);
      const hits = name.filter((word) => target.includes(word)).length;
      return { item, hits, first: name[0] === target[0], extra: name.length - hits };
    })
    .filter((row) => row.first && row.hits >= 1)
    .sort((a, b) => b.hits - a.hits || a.extra - b.extra);
  if (!scored.length) return { item: null, candidates: [] };
  const tied = scored.filter((row) => row.hits === scored[0].hits && row.extra === scored[0].extra).map((row) => row.item);
  return tied.length === 1 ? { item: tied[0], candidates: tied } : { item: null, candidates: tied };
}

// Desempate pelo último preço pago: o candidato com preço mais perto do preço da nota (até 35% de diferença).
function closestByPrice(candidates: { id: number; name: string }[], unitPrice: number, lastPrice: Map<number, number>) {
  const priced = candidates
    .filter((item) => lastPrice.has(item.id))
    .map((item) => ({ item, diff: Math.abs(lastPrice.get(item.id)! - unitPrice) / unitPrice }))
    .sort((a, b) => a.diff - b.diff);
  if (!priced.length || priced[0].diff > 0.35) return null;
  if (priced[1] && priced[1].diff - priced[0].diff < 0.05) return null; // preços parecidos demais para decidir
  return priced[0].item;
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
    const [supplier, duplicate, links, items, types, payments, otherLinks, lastPrices] = await Promise.all([
      queryOne(db, "SELECT id, name FROM suppliers WHERE document = ? ORDER BY is_active DESC, id LIMIT 1", [nfce.document]),
      queryOne(db, "SELECT id, purchase_date FROM purchases WHERE access_key = ?", [nfce.key || key]),
      queryAll(db, "SELECT * FROM invoice_product_links WHERE supplier_document = ?", [nfce.document]),
      queryAll(db, "SELECT id, name FROM items WHERE is_active = 1"),
      queryAll(db, "SELECT id, name FROM movement_types WHERE name IN ('Insumos', 'Retirada')"),
      queryAll(db, "SELECT id, name FROM payment_methods"),
      // Mesmo produto (pela descrição) já ligado em outro mercado.
      queryAll(db, "SELECT * FROM invoice_product_links WHERE supplier_document <> ? AND destination <> 'skip' ORDER BY updated_at DESC", [nfce.document]),
      queryAll(
        db,
        `SELECT DISTINCT ON (item_id) item_id, total_amount / quantity AS price FROM inventory_entries
         WHERE quantity > 0 AND total_amount > 0 ORDER BY item_id, movement_date DESC, id DESC`,
      ),
    ]);
    const byDescription = new Map<string, Record<string, unknown>>();
    otherLinks.forEach((row) => {
      const key = normalizeText(String(row.description || ""));
      if (key && !byDescription.has(key)) byDescription.set(key, row);
    });
    const lastPrice = new Map(lastPrices.map((row) => [num(row.item_id), num(row.price)]));
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
      const link = byKey.get(sourceKey) || byDescription.get(normalizeText(item.description));
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
          hint: String(link.supplier_document) === nfce.document ? null : "ligado assim em outro mercado",
        };
      }
      const { item: byName, candidates } = guessItem(item.description, itemList);
      const guess = byName || (candidates.length > 1 ? closestByPrice(candidates, item.unitPrice, lastPrice) : null);
      // "Dz" (dúzia) para item contado por unidade: 12 por dúzia.
      const dozen = guess && /\bdz\b|duzia/i.test(normalizeText(item.description)) && /unidade/i.test(guess.name);
      const undecided = !guess && candidates.length > 1;
      return {
        source,
        // Parece item de estoque mas há mais de uma embalagem: fica em Estoque, esperando a escolha.
        destination: guess || undecided ? "inventory" : "financial",
        itemId: guess?.id ?? null,
        movementTypeId: typeId("Insumos"),
        description: item.description,
        quantity: dozen ? item.qty * 12 : item.qty,
        origin: guess || undecided ? "palpite" : null,
        hint: undecided
          ? `escolha entre: ${candidates.map((row) => row.name).join(" / ")}`
          : guess && !byName
            ? `escolhido pelo último preço pago (${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(lastPrice.get(guess.id) || 0)})`
            : null,
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

/* ---------- Produtos das notas: revisar o que o sistema aprendeu ---------- */

export type InvoiceLinkRow = {
  id: number;
  supplierName: string;
  supplierDocument: string;
  description: string;
  destination: InvoiceLineDraft["destination"];
  itemId: number | null;
  itemName: string | null;
  financialDescription: string | null;
  qtyFactor: number;
  updatedAt: string;
};

export async function getInvoiceLinks(): Promise<InvoiceLinkRow[]> {
  return withDatabase(async (db) => {
    const rows = await queryAll(
      db,
      `SELECT l.*, i.name AS item_name,
         (SELECT s.name FROM suppliers s WHERE s.document = l.supplier_document ORDER BY s.is_active DESC, s.id LIMIT 1) AS supplier_name
       FROM invoice_product_links l LEFT JOIN items i ON i.id = l.item_id
       ORDER BY supplier_name NULLS LAST, lower(l.description)`,
    );
    return rows.map((row) => ({
      id: num(row.id),
      supplierName: row.supplier_name ? String(row.supplier_name) : `CNPJ ${row.supplier_document}`,
      supplierDocument: String(row.supplier_document),
      description: String(row.description || ""),
      destination: String(row.destination) as InvoiceLineDraft["destination"],
      itemId: row.item_id == null ? null : num(row.item_id),
      itemName: row.item_name ? String(row.item_name) : null,
      financialDescription: row.financial_description ? String(row.financial_description) : null,
      qtyFactor: num(row.qty_factor) || 1,
      updatedAt: String(row.updated_at || ""),
    }));
  });
}

export async function saveInvoiceLink(input: {
  id: number;
  destination: InvoiceLineDraft["destination"];
  itemId?: number | null;
  qtyFactor?: number;
  financialDescription?: string;
}) {
  if (!["inventory", "financial", "personal", "skip"].includes(input.destination)) throw new Error("Destino inválido.");
  if (input.destination === "inventory" && !input.itemId) throw new Error("Escolha o item do estoque.");
  const factor = input.qtyFactor && input.qtyFactor > 0 ? input.qtyFactor : 1;
  return withTransaction(async (db) => {
    const types = await queryAll(db, "SELECT id, name FROM movement_types WHERE name IN ('Insumos', 'Retirada')");
    const typeId = (name: string) => num(types.find((row) => row.name === name)?.id) || null;
    await dbHelpers.run(
      db,
      `UPDATE invoice_product_links SET destination = ?, item_id = ?, qty_factor = ?, movement_type_id = ?, financial_description = ?, updated_at = agora_texto()
       WHERE id = ?`,
      [
        input.destination,
        input.destination === "inventory" ? input.itemId : null,
        input.destination === "inventory" ? factor : 1,
        input.destination === "financial" ? typeId("Insumos") : input.destination === "personal" ? typeId("Retirada") : null,
        input.destination === "financial" || input.destination === "personal" ? input.financialDescription?.trim() || null : null,
        input.id,
      ],
    );
  });
}

export async function deleteInvoiceLink(id: number) {
  return withTransaction((db) => dbHelpers.run(db, "DELETE FROM invoice_product_links WHERE id = ?", [id]));
}
