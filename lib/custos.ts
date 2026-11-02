import { dbHelpers, withDatabase, withTransaction, type Db } from "@/lib/db";
import {
  contentFromName,
  priceKey,
  productCost,
  type ContentUnit,
  type CostLine,
  type LineKind,
  type LineUnit,
  type PriceInfo,
  type ProductCost,
  type Stage,
} from "@/lib/custos-calc";

/* ===================================================================
   Custos dos produtos (fichas técnicas)
   Cada produto tem uma receita (rendimento + ingredientes e materiais).
   O custo usa sempre o ÚLTIMO preço pago de cada item. Só gerencial:
   nada aqui mexe no estoque nem no financeiro.
   =================================================================== */

const { queryAll, queryOne, run } = dbHelpers;
const num = (value: unknown) => Number(value || 0);
const INDIRECT_KEY = "custo_indireto_padrao";

export type ProductLineRecord = CostLine & { id?: number };

export type ProductRecord = {
  id: number;
  name: string;
  category: string | null;
  yieldQty: number;
  yieldUnit: string;
  salePrice: number | null;
  targetMargin: number | null;
  indirectPct: number | null; // vazio = padrão do sistema
  prepMinutes: number | null;
  notes: string | null;
  isActive: boolean;
  updatedAt: string;
  lines: ProductLineRecord[];
  stages: Stage[];
};

export type PriceBook = Record<string, PriceInfo>;

// Último preço pago por embalagem de cada item de estoque e de cada item padrão de uso imediato.
async function loadPriceBook(db: Db): Promise<PriceBook> {
  const [items, lastEntries, immediates, lastImmediate] = await Promise.all([
    queryAll(db, "SELECT id, name, reference_price, content_qty, content_unit FROM items"),
    queryAll(
      db,
      `SELECT DISTINCT ON (e.item_id) e.item_id, e.total_amount / e.quantity AS price, e.movement_date, s.name AS supplier
       FROM inventory_entries e
       LEFT JOIN purchase_items pi ON pi.inventory_entry_id = e.id
       LEFT JOIN purchases p ON p.id = pi.purchase_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE e.quantity > 0 AND e.total_amount > 0
       ORDER BY e.item_id, e.movement_date DESC, e.id DESC`,
    ),
    queryAll(db, "SELECT id FROM immediate_items"),
    queryAll(
      db,
      `SELECT DISTINCT ON (f.immediate_item_id) f.immediate_item_id, f.amount, pi.quantity, f.movement_date, s.name AS supplier
       FROM financial_transactions f
       LEFT JOIN purchase_items pi ON pi.financial_transaction_id = f.id
       LEFT JOIN purchases p ON p.id = pi.purchase_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE f.immediate_item_id IS NOT NULL AND f.amount > 0
       ORDER BY f.immediate_item_id, f.movement_date DESC, f.id DESC`,
    ),
  ]);
  const book: PriceBook = {};
  const entries = new Map(lastEntries.map((row) => [num(row.item_id), row]));
  items.forEach((row) => {
    const entry = entries.get(num(row.id));
    const saved = row.content_qty != null && row.content_unit != null;
    const parsed = saved ? null : contentFromName(String(row.name));
    book[`i${num(row.id)}`] = {
      price: entry ? num(entry.price) : row.reference_price != null ? num(row.reference_price) : null,
      date: entry ? String(entry.movement_date) : null,
      supplier: entry?.supplier ? String(entry.supplier) : entry ? null : row.reference_price != null ? "preço de referência" : null,
      contentQty: saved ? num(row.content_qty) : parsed?.qty ?? 1,
      contentUnit: saved ? (String(row.content_unit) as ContentUnit) : parsed?.unit ?? "un",
      contentSource: saved ? "cadastro" : parsed ? "nome" : "padrão",
    };
  });
  const lastByImmediate = new Map(lastImmediate.map((row) => [num(row.immediate_item_id), row]));
  immediates.forEach((row) => {
    const last = lastByImmediate.get(num(row.id));
    const qty = last?.quantity == null ? null : num(last.quantity);
    book[`m${num(row.id)}`] = {
      price: last ? (qty && qty > 0 ? num(last.amount) / qty : num(last.amount)) : null,
      date: last ? String(last.movement_date) : null,
      supplier: last?.supplier ? String(last.supplier) : null,
      contentQty: 1,
      contentUnit: "un",
      contentSource: "padrão",
      perPurchase: Boolean(last) && qty == null,
    };
  });
  return book;
}

async function loadIndirectDefault(db: Db) {
  const row = await queryOne(db, "SELECT value FROM meta WHERE key = ?", [INDIRECT_KEY]);
  const value = Number(row?.value);
  return Number.isFinite(value) && value >= 0 ? value : 0.1;
}

function mapStage(row: Record<string, unknown>): Stage {
  return { name: String(row.name), day: num(row.day_number) || 1, minutes: num(row.minutes), fixed: num(row.fixed_time) === 1 };
}

function mapProduct(row: Record<string, unknown>, lines: ProductLineRecord[], stages: Stage[]): ProductRecord {
  return {
    id: num(row.id),
    name: String(row.name),
    category: row.category == null ? null : String(row.category),
    yieldQty: num(row.yield_qty) || 1,
    yieldUnit: String(row.yield_unit || "unidades"),
    salePrice: row.sale_price == null ? null : num(row.sale_price),
    targetMargin: row.target_margin == null ? null : num(row.target_margin),
    indirectPct: row.indirect_pct == null ? null : num(row.indirect_pct),
    prepMinutes: row.prep_minutes == null ? null : num(row.prep_minutes),
    notes: row.notes == null ? null : String(row.notes),
    isActive: num(row.is_active) === 1,
    updatedAt: String(row.updated_at || ""),
    lines,
    stages,
  };
}

function mapLine(row: Record<string, unknown>): ProductLineRecord {
  return {
    id: num(row.id),
    kind: String(row.kind) as LineKind,
    itemId: row.item_id == null ? null : num(row.item_id),
    immediateItemId: row.immediate_item_id == null ? null : num(row.immediate_item_id),
    description: row.description == null ? null : String(row.description),
    quantity: num(row.quantity),
    unit: String(row.unit) as LineUnit,
    perUnit: num(row.per_unit) === 1,
    manualCost: row.manual_cost == null ? null : num(row.manual_cost),
  };
}

export function costOf(product: ProductRecord, book: PriceBook, indirectDefault: number): ProductCost {
  return productCost(
    {
      yieldQty: product.yieldQty,
      salePrice: product.salePrice,
      targetMargin: product.targetMargin,
      indirectPct: product.indirectPct ?? indirectDefault,
    },
    product.lines,
    (line) => book[priceKey(line)],
  );
}

export async function getCostsOverview() {
  return withDatabase(async (db) => {
    const [products, lines, stages, book, indirectDefault] = await Promise.all([
      queryAll(db, "SELECT * FROM products ORDER BY is_active DESC, lower(coalesce(category, '')), lower(name)"),
      queryAll(db, "SELECT * FROM product_lines ORDER BY product_id, position, id"),
      queryAll(db, "SELECT * FROM product_stages ORDER BY product_id, day_number, position, id"),
      loadPriceBook(db),
      loadIndirectDefault(db),
    ]);
    const byProduct = new Map<number, ProductLineRecord[]>();
    lines.forEach((row) => {
      const id = num(row.product_id);
      if (!byProduct.has(id)) byProduct.set(id, []);
      byProduct.get(id)!.push(mapLine(row));
    });
    const stagesByProduct = new Map<number, Stage[]>();
    stages.forEach((row) => {
      const id = num(row.product_id);
      if (!stagesByProduct.has(id)) stagesByProduct.set(id, []);
      stagesByProduct.get(id)!.push(mapStage(row));
    });
    const rows = products.map((row) => {
      const product = mapProduct(row, byProduct.get(num(row.id)) || [], stagesByProduct.get(num(row.id)) || []);
      return { product, cost: costOf(product, book, indirectDefault) };
    });
    return { rows, indirectDefault };
  });
}

// Tudo o que a ficha precisa para calcular na tela enquanto se digita.
export async function getCostEditorData(productId: number) {
  return withDatabase(async (db) => {
    const [book, indirectDefault, items, immediates, categories] = await Promise.all([
      loadPriceBook(db),
      loadIndirectDefault(db),
      queryAll(
        db,
        `SELECT i.id, i.name, i.is_active, c.name AS category FROM items i
         LEFT JOIN item_categories c ON c.id = i.category_id ORDER BY lower(i.name)`,
      ),
      queryAll(db, "SELECT id, name, unit_label, is_active FROM immediate_items ORDER BY lower(name)"),
      queryAll(db, "SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category"),
    ]);
    let product: ProductRecord | null = null;
    if (productId) {
      const row = await queryOne(db, "SELECT * FROM products WHERE id = ?", [productId]);
      if (row) {
        const lines = await queryAll(db, "SELECT * FROM product_lines WHERE product_id = ? ORDER BY position, id", [productId]);
        const stages = await queryAll(db, "SELECT * FROM product_stages WHERE product_id = ? ORDER BY day_number, position, id", [productId]);
        product = mapProduct(row, lines.map(mapLine), stages.map(mapStage));
      }
    }
    const used = new Set((product?.lines || []).map((line) => priceKey(line)));
    return {
      product,
      book,
      indirectDefault,
      categories: categories.map((row) => String(row.category)),
      itemOptions: items
        .filter((row) => num(row.is_active) === 1 || used.has(`i${num(row.id)}`))
        .map((row) => ({ id: num(row.id), name: String(row.name), group: row.category == null ? null : String(row.category) })),
      immediateOptions: immediates
        .filter((row) => num(row.is_active) === 1 || used.has(`m${num(row.id)}`))
        .map((row) => ({ id: num(row.id), name: String(row.name), group: row.unit_label == null ? "uso imediato" : String(row.unit_label) })),
    };
  });
}

export type ProductInput = {
  id?: number;
  name: string;
  category?: string | null;
  yieldQty: number;
  yieldUnit?: string | null;
  salePrice?: number | null;
  targetMargin?: number | null;
  indirectPct?: number | null;
  prepMinutes?: number | null;
  notes?: string | null;
  lines: CostLine[];
  stages?: Stage[];
};

const UNITS: LineUnit[] = ["g", "kg", "ml", "l", "un", "emb"];

export async function saveProduct(input: ProductInput) {
  return withTransaction(async (db) => {
    const name = input.name?.trim();
    if (!name) throw new Error("Informe o nome do produto.");
    if (!(input.yieldQty > 0)) throw new Error("Informe quanto a receita rende (maior que zero).");
    if (input.targetMargin != null && !(input.targetMargin >= 0 && input.targetMargin < 1)) {
      throw new Error("A margem desejada deve ficar entre 0% e 99%.");
    }
    if (input.indirectPct != null && !(input.indirectPct >= 0 && input.indirectPct <= 5)) {
      throw new Error("O percentual de custos indiretos deve ficar entre 0% e 500%.");
    }
    const stages = input.stages || [];
    for (const [index, stage] of stages.entries()) {
      const label = `Etapa ${index + 1}`;
      if (!stage.name?.trim()) throw new Error(`${label}: informe o nome (ex.: massa, rechear, embalar).`);
      if (!(Number.isInteger(stage.day) && stage.day >= 1 && stage.day <= 60)) throw new Error(`${label}: o dia deve ser de 1 a 60.`);
      if (!(stage.minutes > 0)) throw new Error(`${label}: informe o tempo.`);
    }
    for (const [index, line] of input.lines.entries()) {
      const label = `Linha ${index + 1}`;
      if (line.kind === "manual") {
        if (!line.description?.trim()) throw new Error(`${label}: informe a descrição do custo.`);
        if (!(Number(line.manualCost) >= 0)) throw new Error(`${label}: informe o valor do custo.`);
        continue;
      }
      if (!(line.quantity > 0)) throw new Error(`${label}: informe a quantidade.`);
      if (!UNITS.includes(line.unit)) throw new Error(`${label}: unidade inválida.`);
      if (line.kind === "item") {
        if (!(await queryOne(db, "SELECT id FROM items WHERE id = ?", [line.itemId || 0]))) {
          throw new Error(`${label}: escolha um item do estoque da lista.`);
        }
      } else if (line.kind === "immediate") {
        if (!(await queryOne(db, "SELECT id FROM immediate_items WHERE id = ?", [line.immediateItemId || 0]))) {
          throw new Error(`${label}: escolha um item de uso imediato da lista.`);
        }
      } else {
        throw new Error(`${label}: tipo inválido.`);
      }
    }

    const values = [
      name,
      input.category?.trim() || null,
      input.yieldQty,
      input.yieldUnit?.trim() || "unidades",
      input.salePrice ?? null,
      input.targetMargin ?? null,
      input.indirectPct ?? null,
      stages.length ? stages.reduce((sum, stage) => sum + Math.round(stage.minutes), 0) : null,
      input.notes?.trim() || null,
    ];
    let id = input.id || 0;
    if (id) {
      const updated = await run(
        db,
        `UPDATE products SET name = ?, category = ?, yield_qty = ?, yield_unit = ?, sale_price = ?, target_margin = ?,
           indirect_pct = ?, prep_minutes = ?, notes = ?, updated_at = agora_texto()
         WHERE id = ? RETURNING id`,
        [...values, id],
      );
      if (!updated.length) throw new Error("Produto não encontrado.");
      await run(db, "DELETE FROM product_lines WHERE product_id = ?", [id]);
      await run(db, "DELETE FROM product_stages WHERE product_id = ?", [id]);
    } else {
      const inserted = await run(
        db,
        `INSERT INTO products (name, category, yield_qty, yield_unit, sale_price, target_margin, indirect_pct, prep_minutes, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        values,
      );
      id = num(inserted[0]?.id);
    }
    for (const [position, line] of input.lines.entries()) {
      const manual = line.kind === "manual";
      await run(
        db,
        `INSERT INTO product_lines (product_id, position, kind, item_id, immediate_item_id, description, quantity, unit, per_unit, manual_cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          position,
          line.kind,
          line.kind === "item" ? line.itemId : null,
          line.kind === "immediate" ? line.immediateItemId : null,
          manual ? line.description!.trim() : null,
          manual ? 1 : line.quantity,
          manual ? "emb" : line.unit,
          line.perUnit ? 1 : 0,
          manual ? Number(line.manualCost) : null,
        ],
      );
    }
    for (const [position, stage] of stages.entries()) {
      await run(
        db,
        "INSERT INTO product_stages (product_id, position, name, day_number, minutes, fixed_time) VALUES (?, ?, ?, ?, ?, ?)",
        [id, position, stage.name.trim(), stage.day, Math.round(stage.minutes), stage.fixed ? 1 : 0],
      );
    }
    return id;
  });
}

export async function duplicateProduct(productId: number) {
  return withTransaction(async (db) => {
    const row = await queryOne(db, "SELECT * FROM products WHERE id = ?", [productId]);
    if (!row) throw new Error("Produto não encontrado.");
    let name = `${String(row.name)} (cópia)`;
    for (let n = 2; await queryOne(db, "SELECT id FROM products WHERE lower(name) = lower(?)", [name]); n += 1) {
      name = `${String(row.name)} (cópia ${n})`;
    }
    const inserted = await run(
      db,
      `INSERT INTO products (name, category, yield_qty, yield_unit, sale_price, target_margin, indirect_pct, prep_minutes, notes)
       SELECT ?, category, yield_qty, yield_unit, sale_price, target_margin, indirect_pct, prep_minutes, notes
       FROM products WHERE id = ? RETURNING id`,
      [name, productId],
    );
    const id = num(inserted[0]?.id);
    await run(
      db,
      `INSERT INTO product_lines (product_id, position, kind, item_id, immediate_item_id, description, quantity, unit, per_unit, manual_cost)
       SELECT ?, position, kind, item_id, immediate_item_id, description, quantity, unit, per_unit, manual_cost
       FROM product_lines WHERE product_id = ?`,
      [id, productId],
    );
    await run(
      db,
      `INSERT INTO product_stages (product_id, position, name, day_number, minutes, fixed_time)
       SELECT ?, position, name, day_number, minutes, fixed_time FROM product_stages WHERE product_id = ?`,
      [id, productId],
    );
    return id;
  });
}

export async function setProductActive(productId: number, active: boolean) {
  return withTransaction(async (db) => {
    await run(db, "UPDATE products SET is_active = ?, updated_at = agora_texto() WHERE id = ?", [active ? 1 : 0, productId]);
  });
}

export async function setIndirectDefault(value: number) {
  if (!(value >= 0 && value <= 5)) throw new Error("O percentual deve ficar entre 0% e 500%.");
  return withTransaction(async (db) => {
    await run(
      db,
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [INDIRECT_KEY, String(value)],
    );
  });
}
