import { dbHelpers, withDatabase, withTransaction, type Db } from "@/lib/db";
import { resolveSelectedPeriod } from "@/lib/data";
import type { SearchParams } from "@/lib/types";
import { currentYearMonth, normalizeText, toMonthKey } from "@/lib/utils";

/* ===================================================================
   Itens padrão de uso imediato
   Morango, frutas, topper, entrega… não entram no estoque, mas ganham um nome
   fixo para acompanhar quanto se gasta, com que frequência e a que preço.
   Os lançamentos continuam iguais; só recebem o vínculo (immediate_item_id).
   =================================================================== */

const { queryAll, queryOne, run } = dbHelpers;
const num = (value: unknown) => Number(value || 0);
const DAY = 86_400_000;
const IMMEDIATE_TYPES = ["Insumos", "Despesa"];

export type ImmediateItem = {
  id: number;
  name: string;
  movementTypeId: number;
  typeName: string;
  unitLabel: string | null;
  notes: string | null;
  isActive: boolean;
};

async function listItems(db: Db): Promise<ImmediateItem[]> {
  const rows = await queryAll(
    db,
    `SELECT i.*, t.name AS type_name FROM immediate_items i
     JOIN movement_types t ON t.id = i.movement_type_id
     ORDER BY i.is_active DESC, lower(i.name)`,
  );
  return rows.map((row) => ({
    id: num(row.id),
    name: String(row.name),
    movementTypeId: num(row.movement_type_id),
    typeName: String(row.type_name),
    unitLabel: row.unit_label == null ? null : String(row.unit_label),
    notes: row.notes == null ? null : String(row.notes),
    isActive: num(row.is_active) === 1,
  }));
}

export async function getImmediateItems() {
  return withDatabase((db) => listItems(db));
}

async function assertImmediateType(db: Db, movementTypeId: number) {
  const type = await queryOne(db, "SELECT name FROM movement_types WHERE id = ?", [movementTypeId]);
  if (!type || !IMMEDIATE_TYPES.includes(String(type.name))) {
    throw new Error("Escolha Insumos ou Despesa como tipo do item padrão.");
  }
}

export async function saveImmediateItem(input: {
  id?: number;
  name: string;
  movementTypeId: number;
  unitLabel?: string;
  notes?: string;
}) {
  return withTransaction(async (db) => {
    const name = input.name.trim();
    if (!name) throw new Error("Informe o nome do item padrão.");
    await assertImmediateType(db, input.movementTypeId);
    if (input.id) {
      await run(
        db,
        "UPDATE immediate_items SET name = ?, movement_type_id = ?, unit_label = ?, notes = ? WHERE id = ?",
        [name, input.movementTypeId, input.unitLabel?.trim() || null, input.notes?.trim() || null, input.id],
      );
    } else {
      await run(
        db,
        "INSERT INTO immediate_items (name, movement_type_id, unit_label, notes) VALUES (?, ?, ?, ?)",
        [name, input.movementTypeId, input.unitLabel?.trim() || null, input.notes?.trim() || null],
      );
    }
  });
}

export async function setImmediateItemActive(id: number, active: boolean) {
  return withTransaction(async (db) => {
    await run(db, "UPDATE immediate_items SET is_active = ? WHERE id = ?", [active ? 1 : 0, id]);
  });
}

// Liga lançamentos antigos (mesma descrição, com ou sem acento/maiúsculas) a um item padrão.
// Não muda valor, data nem descrição: só a classificação. Por isso vale também para meses fechados.
export async function linkDescriptions(input: {
  variants: string[];
  typeName: string;
  itemId?: number | null;
  newName?: string;
}) {
  return withTransaction(async (db) => {
    const variants = input.variants.map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (!variants.length) throw new Error("Nenhuma descrição para vincular.");
    if (!IMMEDIATE_TYPES.includes(input.typeName)) throw new Error("Tipo de lançamento inválido.");
    let itemId = input.itemId || 0;
    if (!itemId) {
      const name = input.newName?.trim();
      if (!name) throw new Error("Escolha um item padrão ou informe o nome do novo.");
      const type = await queryOne(db, "SELECT id FROM movement_types WHERE name = ?", [input.typeName]);
      const existing = await queryOne(db, "SELECT id FROM immediate_items WHERE lower(name) = lower(?)", [name]);
      itemId = existing
        ? num(existing.id)
        : num((await run(db, "INSERT INTO immediate_items (name, movement_type_id) VALUES (?, ?) RETURNING id", [name, num(type?.id)]))[0]?.id);
    }
    const updated = await run(
      db,
      `UPDATE financial_transactions f SET immediate_item_id = ?
       FROM movement_types t
       WHERE t.id = f.movement_type_id AND t.name = ? AND f.immediate_item_id IS NULL
         AND lower(trim(f.description)) = ANY(?)
       RETURNING f.id`,
      [itemId, input.typeName, variants],
    );
    await run(
      db,
      `UPDATE purchase_items SET immediate_item_id = ?
       WHERE immediate_item_id IS NULL AND financial_transaction_id IN (
         SELECT id FROM financial_transactions WHERE immediate_item_id = ?)`,
      [itemId, itemId],
    );
    return updated.length;
  });
}

// Desfaz todos os vínculos de um item (para corrigir uma classificação errada).
export async function unlinkImmediateItem(id: number) {
  return withTransaction(async (db) => {
    await run(db, "UPDATE purchase_items SET immediate_item_id = NULL WHERE immediate_item_id = ?", [id]);
    const rows = await run(db, "UPDATE financial_transactions SET immediate_item_id = NULL WHERE immediate_item_id = ? RETURNING id", [id]);
    return rows.length;
  });
}

/* ---------- Acompanhamento (tela Reposição › Uso imediato) ---------- */

export type ImmediateTrackingRow = ImmediateItem & {
  monthly: number[]; // gasto em cada mês da janela
  average: number; // média por mês dos meses anteriores ao selecionado (desde a 1ª compra)
  current: number; // gasto no mês selecionado
  variation: number | null; // mês selecionado × média
  spread: number | null; // quanto o gasto mensal costuma variar (desvio ÷ média)
  purchases: number; // compras na janela
  lastDate: string | null;
  intervalDays: number | null; // intervalo médio entre compras (últimos 6 meses)
  lastUnitPrice: number | null;
  averageUnitPrice: number | null;
  totalWindow: number;
};

export type UnlinkedGroup = {
  key: string;
  label: string;
  typeName: string;
  variants: string[];
  count: number;
  total: number;
  lastDate: string;
  suggestedItemId: number | null;
};

const WINDOW_MONTHS = 6;

function monthKeys(year: number, month: number) {
  const keys: { key: string; year: number; month: number }[] = [];
  for (let back = WINDOW_MONTHS - 1; back >= 0; back -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - back, 1));
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    keys.push({ key: `${y}-${String(m).padStart(2, "0")}`, year: y, month: m });
  }
  return keys;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export async function getImmediateTracking(params: SearchParams) {
  return withDatabase(async (db) => {
    const period = await resolveSelectedPeriod(db, params);
    const months = monthKeys(period.year, period.month);
    const start = `${months[0].key}-01`;
    const end = `${months[months.length - 1].key}-31`;
    const items = await listItems(db);

    const [spending, history, unlinked] = await Promise.all([
      queryAll(
        db,
        `SELECT f.immediate_item_id AS item_id, substr(f.movement_date, 1, 7) AS ym, SUM(f.amount) AS total
         FROM financial_transactions f JOIN movement_types t ON t.id = f.movement_type_id
         WHERE t.name IN ('Insumos', 'Despesa') AND f.movement_date BETWEEN ? AND ?
         GROUP BY f.immediate_item_id, ym`,
        [start, end],
      ),
      queryAll(
        db,
        `SELECT f.immediate_item_id AS item_id, f.movement_date, f.amount, pi.quantity
         FROM financial_transactions f LEFT JOIN purchase_items pi ON pi.financial_transaction_id = f.id
         WHERE f.immediate_item_id IS NOT NULL AND f.movement_date <= ?
         ORDER BY f.movement_date`,
        [end],
      ),
      queryAll(
        db,
        `SELECT lower(trim(f.description)) AS variant, MIN(f.description) AS label, t.name AS type_name,
           COUNT(*) AS n, SUM(f.amount) AS total, MAX(f.movement_date) AS last_date
         FROM financial_transactions f JOIN movement_types t ON t.id = f.movement_type_id
         WHERE t.name IN ('Insumos', 'Despesa') AND f.immediate_item_id IS NULL
         GROUP BY variant, t.name`,
      ),
    ]);

    const monthIndex = new Map(months.map((month, index) => [month.key, index]));
    const spendByItem = new Map<number, number[]>();
    const totalsByMonth = months.map(() => ({ linked: 0, unlinked: 0 }));
    spending.forEach((row) => {
      const index = monthIndex.get(String(row.ym));
      if (index === undefined) return;
      if (row.item_id == null) {
        totalsByMonth[index].unlinked += num(row.total);
        return;
      }
      const id = num(row.item_id);
      if (!spendByItem.has(id)) spendByItem.set(id, months.map(() => 0));
      spendByItem.get(id)![index] += num(row.total);
      totalsByMonth[index].linked += num(row.total);
    });

    const historyByItem = new Map<number, { date: string; amount: number; quantity: number | null }[]>();
    history.forEach((row) => {
      const id = num(row.item_id);
      if (!historyByItem.has(id)) historyByItem.set(id, []);
      historyByItem.get(id)!.push({
        date: String(row.movement_date),
        amount: num(row.amount),
        quantity: row.quantity == null ? null : num(row.quantity),
      });
    });

    const rows: ImmediateTrackingRow[] = items.map((item) => {
      const monthly = spendByItem.get(item.id) || months.map(() => 0);
      const all = historyByItem.get(item.id) || [];
      const inWindow = all.filter((row) => row.date >= start);
      const firstKey = all[0]?.date.slice(0, 7);
      const firstIndex = firstKey ? Math.max(months.findIndex((month) => month.key >= firstKey), 0) : 0;
      const previous = monthly.slice(firstIndex, -1);
      const average = mean(previous);
      const current = monthly[monthly.length - 1];
      const spreadBase = monthly.slice(firstIndex);
      const spreadMean = mean(spreadBase);
      const spread =
        spreadBase.length >= 3 && spreadMean > 0
          ? Math.sqrt(mean(spreadBase.map((value) => (value - spreadMean) ** 2))) / spreadMean
          : null;
      const dates = Array.from(new Set(inWindow.map((row) => row.date))).sort();
      const intervalDays =
        dates.length >= 2 ? (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / DAY / (dates.length - 1) : null;
      const priced = inWindow.filter((row) => row.quantity && row.quantity > 0);
      const unitPrices = priced.map((row) => row.amount / (row.quantity as number));
      const pricedQty = priced.reduce((sum, row) => sum + (row.quantity as number), 0);
      return {
        ...item,
        monthly,
        average,
        current,
        variation: average > 0 ? current / average - 1 : null,
        spread,
        purchases: inWindow.length,
        lastDate: all.length ? all[all.length - 1].date : null,
        intervalDays,
        lastUnitPrice: unitPrices.length ? unitPrices[unitPrices.length - 1] : null,
        averageUnitPrice: pricedQty > 0 ? priced.reduce((sum, row) => sum + row.amount, 0) / pricedQty : null,
        totalWindow: monthly.reduce((sum, value) => sum + value, 0),
      };
    });

    // Descrições sem item padrão, juntando variações de acento e maiúsculas.
    const activeItems = items.filter((item) => item.isActive);
    const groups = new Map<string, UnlinkedGroup>();
    unlinked.forEach((row) => {
      const typeName = String(row.type_name);
      const key = `${typeName}|${normalizeText(String(row.variant))}`;
      const current = groups.get(key);
      if (current) {
        current.variants.push(String(row.variant));
        current.count += num(row.n);
        current.total += num(row.total);
        if (String(row.last_date) > current.lastDate) current.lastDate = String(row.last_date);
        return;
      }
      groups.set(key, {
        key,
        label: String(row.label),
        typeName,
        variants: [String(row.variant)],
        count: num(row.n),
        total: num(row.total),
        lastDate: String(row.last_date),
        suggestedItemId: null,
      });
    });
    const unlinkedGroups = Array.from(groups.values()).map((group) => {
      const text = normalizeText(group.label);
      const candidates = activeItems
        .map((item) => ({ item, name: normalizeText(item.name) }))
        .filter(({ name }) => text === name || text.startsWith(`${name} `) || name.startsWith(`${text} `));
      candidates.sort((a, b) => b.name.length - a.name.length);
      return { ...group, suggestedItemId: candidates[0]?.item.id ?? null };
    });
    unlinkedGroups.sort((a, b) => b.total - a.total);

    return {
      period,
      months,
      rows,
      totalsByMonth,
      unlinkedGroups,
      monthIsOpen: months[months.length - 1].key >= toMonthKey(currentYearMonth().year, currentYearMonth().month),
    };
  });
}
