import { dbHelpers, withDatabase, withTransaction, type Db } from "@/lib/db";
import {
  getItemMetricsInternal,
  getPeriodsForYear,
  getResolvedPeriodData,
  periodFromDate,
  resolveSelectedPeriod,
} from "@/lib/data";
import type { ItemMetrics, SearchParams } from "@/lib/types";

const { queryAll, run } = dbHelpers;

const num = (value: unknown) => Number(value || 0);
const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/* ===================================================================
   Contagem física em lote
   A pessoa informa quanto SOBROU de cada item; o sistema calcula a baixa
   (saldo no sistema na data − contado) e lança tudo de uma vez.
   =================================================================== */

export type CountRow = {
  id: number;
  name: string;
  categoryName: string;
  systemQty: number;
  averageCost: number;
};

// Saldo de cada item na data: saldo do fim do mês, desfazendo o que foi lançado depois da data.
async function balancesAtDate(db: Db, periodId: number, date: string) {
  const metrics = await getItemMetricsInternal(db, periodId);
  const later = await queryAll(
    db,
    `
      SELECT item_id, SUM(entrada) AS entrada, SUM(baixa) AS baixa FROM (
        SELECT item_id, quantity AS entrada, 0 AS baixa FROM inventory_entries WHERE period_id = ? AND movement_date > ?
        UNION ALL
        SELECT item_id, 0, quantity FROM inventory_usages WHERE period_id = ? AND movement_date > ?
      ) x GROUP BY item_id
    `,
    [periodId, date, periodId, date],
  );
  const adjust = new Map(later.map((row) => [num(row.item_id), num(row.baixa) - num(row.entrada)]));
  return metrics.map((item) => ({ item, qty: item.finalQty + (adjust.get(item.id) || 0) }));
}

export async function getCountSheet(params: SearchParams, date: string) {
  return withDatabase(async (db) => {
    const period = await resolveSelectedPeriod(db, params);
    const rows = await balancesAtDate(db, period.id, date);
    const recent = await queryAll(
      db,
      "SELECT DISTINCT item_id FROM inventory_entries WHERE movement_date >= ?",
      [new Date(Date.parse(date) - 120 * DAY).toISOString().slice(0, 10)],
    );
    const recentIds = new Set(recent.map((row) => num(row.item_id)));
    return rows
      .filter(({ item, qty }) => item.isActive && (Math.abs(qty) > 0.0001 || recentIds.has(item.id)))
      .map(({ item, qty }): CountRow => ({
        id: item.id,
        name: item.name,
        categoryName: item.categoryName,
        systemQty: qty,
        averageCost: item.availableQty > 0 ? item.availableValue / item.availableQty : item.averageCost,
      }))
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName, "pt-BR") || a.name.localeCompare(b.name, "pt-BR"));
  });
}

export async function registerPhysicalCount(input: { date: string; counts: { itemId: number; counted: number }[] }) {
  return withTransaction(async (db) => {
    const period = await periodFromDate(db, input.date);
    const balances = new Map((await balancesAtDate(db, period.id, input.date)).map((row) => [row.item.id, row]));
    let created = 0;
    const surplus: string[] = [];
    for (const count of input.counts) {
      if (!Number.isFinite(count.counted) || count.counted < 0) {
        throw new Error("As quantidades contadas não podem ser negativas.");
      }
      const row = balances.get(count.itemId);
      if (!row) continue;
      const used = Math.round((row.qty - count.counted) * 1000) / 1000;
      if (used > 0) {
        await run(
          db,
          `INSERT INTO inventory_usages (period_id, movement_date, item_id, quantity, notes, source)
           VALUES (?, ?, ?, ?, ?, 'count')`,
          [period.id, input.date, count.itemId, used, `Contagem física: contado ${count.counted}, sistema ${Math.round(row.qty * 1000) / 1000}`],
        );
        created += 1;
      } else if (used < 0) {
        surplus.push(`${row.item.name} (+${Math.round(-used * 100) / 100})`);
      }
    }
    return { created, surplus };
  });
}

/* ===================================================================
   Reposição: mínimo e estoque-alvo calculados pelo histórico de consumo
   =================================================================== */

export type ReplenishmentOptions = {
  cycleDays: number; // de quanto em quanto tempo quer comprar cada item
  leadDays: number; // dias até a próxima ida ao mercado
  z: number; // nível de segurança (1,28 = 90%; 1,65 = 95%)
};

export type ReplenishmentRow = {
  id: number;
  name: string;
  categoryName: string;
  currentQty: number;
  dailyUse: number;
  monthlyUse: number;
  variability: number; // coeficiente de variação do consumo
  intervals: number;
  confidence: "alta" | "média" | "baixa" | "sem consumo";
  cycleDays: number;
  suggestedMin: number;
  suggestedTarget: number;
  savedMin: number;
  savedTarget: number | null;
  savedCycle: number | null;
  coverageDays: number | null;
  status: "comprar" | "ok" | "excesso" | "sem consumo";
  buyQty: number;
  unitPrice: number;
  bestPrice: number;
  lastSupplier: string | null;
  purchaseDays90: number;
};

// Datas de contagem próximas (até 7 dias) viram uma contagem só.
function clusterCountDates(dates: string[]) {
  const clusters: { end: string; members: string[] }[] = [];
  for (const date of dates) {
    const last = clusters[clusters.length - 1];
    if (last && daysBetween(last.end, date) <= 7) {
      last.end = date;
      last.members.push(date);
    } else {
      clusters.push({ end: date, members: [date] });
    }
  }
  return clusters;
}

export async function getReplenishment(params: SearchParams, options: ReplenishmentOptions) {
  return withDatabase(async (db) => {
    const period = await resolveSelectedPeriod(db, params);
    const [metrics, usages, firstSeen, items, prices, firstPeriod] = await Promise.all([
      getItemMetricsInternal(db, period.id),
      queryAll(db, "SELECT item_id, movement_date, quantity FROM inventory_usages ORDER BY movement_date"),
      queryAll(
        db,
        `SELECT item_id, MIN(d) AS first_date FROM (
           SELECT item_id, movement_date AS d FROM inventory_entries
           UNION ALL
           SELECT b.item_id, p.year::text || '-' || lpad(p.month::text, 2, '0') || '-01'
           FROM inventory_opening_balances b JOIN periods p ON p.id = b.period_id WHERE b.quantity > 0
         ) x GROUP BY item_id`,
      ),
      queryAll(db, "SELECT id, low_stock_threshold, target_stock, reorder_cycle_days FROM items"),
      queryAll(
        db,
        `SELECT e.item_id, e.movement_date, e.quantity, e.total_amount, s.name AS supplier_name
         FROM inventory_entries e
         LEFT JOIN purchase_items pi ON pi.inventory_entry_id = e.id
         LEFT JOIN purchases pu ON pu.id = pi.purchase_id
         LEFT JOIN suppliers s ON s.id = pu.supplier_id
         WHERE e.quantity > 0
         ORDER BY e.movement_date, e.id`,
      ),
      queryAll(
        db,
        `SELECT MIN(p.year * 100 + p.month) AS ym FROM periods p
         WHERE EXISTS (SELECT 1 FROM inventory_opening_balances b WHERE b.period_id = p.id)
            OR EXISTS (SELECT 1 FROM inventory_entries e WHERE e.period_id = p.id)`,
      ),
    ]);

    const ym = num(firstPeriod[0]?.ym);
    const detailStart = ym ? `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, "0")}-01` : "2026-01-01";
    const clusters = clusterCountDates(Array.from(new Set(usages.map((row) => String(row.movement_date)))).sort());
    const intervals = clusters.map((cluster, index) => ({
      start: index === 0 ? detailStart : clusters[index - 1].end,
      end: cluster.end,
      members: new Set(cluster.members),
    }));
    // Só os últimos ~7 meses de contagens entram na conta (o consumo muda com o tempo).
    const lastEnd = intervals[intervals.length - 1]?.end;
    const windowed = lastEnd ? intervals.filter((interval) => daysBetween(interval.end, lastEnd) <= 210) : [];

    const usageByItem = new Map<number, Map<string, number>>();
    usages.forEach((row) => {
      const itemId = num(row.item_id);
      if (!usageByItem.has(itemId)) usageByItem.set(itemId, new Map());
      const map = usageByItem.get(itemId)!;
      map.set(String(row.movement_date), (map.get(String(row.movement_date)) || 0) + num(row.quantity));
    });
    const firstSeenMap = new Map(firstSeen.map((row) => [num(row.item_id), String(row.first_date)]));
    const itemParams = new Map(items.map((row) => [num(row.id), row]));
    const priceByItem = new Map<number, Record<string, any>[]>();
    prices.forEach((row) => {
      const itemId = num(row.item_id);
      if (!priceByItem.has(itemId)) priceByItem.set(itemId, []);
      priceByItem.get(itemId)!.push(row);
    });
    const today = lastEnd || new Date().toISOString().slice(0, 10);

    const rows = metrics
      .filter((item) => item.isActive)
      .map((item): ReplenishmentRow => {
        const saved = itemParams.get(item.id);
        const cycleDays = num(saved?.reorder_cycle_days) || options.cycleDays;
        const since = firstSeenMap.get(item.id) || detailStart;
        const used = usageByItem.get(item.id) || new Map<string, number>();
        const own = windowed.filter((interval) => interval.end > since);
        let totalUse = 0;
        let totalDays = 0;
        const rates: { rate: number; days: number }[] = [];
        own.forEach((interval) => {
          const start = interval.start > since ? interval.start : since;
          const days = Math.max(daysBetween(start, interval.end), 1);
          let quantity = 0;
          interval.members.forEach((date) => (quantity += used.get(date) || 0));
          totalUse += quantity;
          totalDays += days;
          rates.push({ rate: quantity / days, days });
        });
        const daily = totalDays > 0 ? totalUse / totalDays : 0;
        const sigma =
          totalDays > 0 ? Math.sqrt(rates.reduce((sum, r) => sum + r.days * (r.rate - daily) ** 2, 0) / totalDays) : 0;
        const variability = daily > 0 ? sigma / daily : 0;
        const nonZero = rates.filter((r) => r.rate > 0).length;
        const confidence: ReplenishmentRow["confidence"] =
          daily <= 0 ? "sem consumo" : own.length >= 4 && variability <= 0.75 && nonZero >= 3 ? "alta" : own.length >= 3 && nonZero >= 2 ? "média" : "baixa";

        // Mínimo: o que precisa ter para chegar à próxima ida ao mercado, com margem para meses mais fortes.
        // Alvo: mínimo + consumo de um ciclo, para só voltar a comprar este item depois do ciclo.
        const safety = options.z * sigma * options.leadDays;
        const suggestedMin = daily > 0 ? Math.ceil(daily * options.leadDays + safety) : 0;
        const suggestedTarget = daily > 0 ? Math.ceil(suggestedMin + daily * cycleDays) : 0;
        const savedMin = num(saved?.low_stock_threshold);
        const savedTarget = saved?.target_stock == null ? null : num(saved.target_stock);
        const effectiveMin = savedTarget != null ? savedMin : suggestedMin;
        const effectiveTarget = savedTarget ?? suggestedTarget;
        const current = item.finalQty;
        const status: ReplenishmentRow["status"] =
          daily <= 0 ? "sem consumo" : current < effectiveMin ? "comprar" : current > effectiveTarget + daily * cycleDays ? "excesso" : "ok";

        const history = priceByItem.get(item.id) || [];
        const last = history[history.length - 1];
        const recent = history.filter((row) => daysBetween(String(row.movement_date), today) <= 90);
        const unitPrices = recent.map((row) => num(row.total_amount) / num(row.quantity));
        const lastSupplier = [...history].reverse().find((row) => row.supplier_name)?.supplier_name ?? null;

        return {
          id: item.id,
          name: item.name,
          categoryName: item.categoryName,
          currentQty: current,
          dailyUse: daily,
          monthlyUse: daily * 30,
          variability,
          intervals: own.length,
          confidence,
          cycleDays,
          suggestedMin,
          suggestedTarget,
          savedMin,
          savedTarget,
          savedCycle: saved?.reorder_cycle_days == null ? null : num(saved.reorder_cycle_days),
          coverageDays: daily > 0 ? current / daily : null,
          status,
          buyQty: status === "comprar" ? Math.max(Math.ceil(effectiveTarget - current), 0) : 0,
          unitPrice: last ? num(last.total_amount) / num(last.quantity) : item.averageCost,
          bestPrice: unitPrices.length ? Math.min(...unitPrices) : 0,
          lastSupplier: lastSupplier ? String(lastSupplier) : null,
          purchaseDays90: new Set(recent.map((row) => String(row.movement_date))).size,
        };
      });

    return { period, lastCount: lastEnd || null, intervals: windowed.length, rows };
  });
}

export async function applyReplenishment(rows: { itemId: number; min: number; target: number; cycle: number | null }[]) {
  return withTransaction(async (db) => {
    for (const row of rows) {
      if (!(row.min >= 0) || !(row.target >= row.min)) {
        throw new Error("O estoque-alvo precisa ser maior ou igual ao mínimo.");
      }
      await run(
        db,
        `UPDATE items SET low_stock_threshold = ?, target_stock = ?, reorder_cycle_days = ?, replenishment_updated_at = agora_texto()
         WHERE id = ?`,
        [row.min, row.target, row.cycle, row.itemId],
      );
    }
    return rows.length;
  });
}

/* ===================================================================
   Dados para a central de relatórios (ano selecionado)
   =================================================================== */

function normalizeDescription(text: string) {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

export async function getYearAnalytics(params: SearchParams) {
  return withDatabase(async (db) => {
    const period = await resolveSelectedPeriod(db, params);
    const year = period.year;
    const periods = (await getPeriodsForYear(db, year)).filter((row) => row.month <= period.month);

    const monthly: { month: number; label: string; summary: Awaited<ReturnType<typeof getResolvedPeriodData>>["summary"]; items: ItemMetrics[] }[] = [];
    for (const row of periods) {
      const resolved = await getResolvedPeriodData(db, row.id);
      monthly.push({ month: row.month, label: row.label, summary: resolved.summary, items: resolved.itemMetrics });
    }

    const yearLike = `${year}-%`;
    const [expenses, revenueByMethod, suppliers, buyDays, paymentSplit] = await Promise.all([
      queryAll(
        db,
        `SELECT t.name AS type_name, f.description, substr(f.movement_date, 6, 2)::int AS month, SUM(f.amount) AS total, COUNT(*) AS n
         FROM financial_transactions f JOIN movement_types t ON t.id = f.movement_type_id
         WHERE f.movement_date LIKE ? AND t.name IN ('Insumos', 'Despesa')
         GROUP BY t.name, f.description, month`,
        [yearLike],
      ),
      queryAll(
        db,
        `SELECT pm.name AS method, substr(f.movement_date, 6, 2)::int AS month, SUM(f.amount) AS total
         FROM financial_transactions f
         JOIN movement_types t ON t.id = f.movement_type_id
         JOIN payment_methods pm ON pm.id = f.payment_method_id
         WHERE f.movement_date LIKE ? AND t.name = 'Receita'
         GROUP BY pm.name, month`,
        [yearLike],
      ),
      queryAll(
        db,
        `SELECT s.name AS supplier, COUNT(DISTINCT p.id) AS notes, COUNT(DISTINCT p.purchase_date) AS days,
           SUM(pi.total_amount) AS total, MIN(p.purchase_date) AS first_date, MAX(p.purchase_date) AS last_date
         FROM purchases p JOIN suppliers s ON s.id = p.supplier_id JOIN purchase_items pi ON pi.purchase_id = p.id
         WHERE p.purchase_date LIKE ?
         GROUP BY s.name ORDER BY total DESC`,
        [yearLike],
      ),
      // "Idas às compras": dias distintos com alguma compra (nota, entrada de estoque ou insumo).
      queryAll(
        db,
        `SELECT substr(d, 6, 2)::int AS month, COUNT(DISTINCT d) AS days FROM (
           SELECT purchase_date AS d FROM purchases WHERE purchase_date LIKE ?
           UNION SELECT movement_date FROM inventory_entries WHERE movement_date LIKE ?
           UNION SELECT f.movement_date FROM financial_transactions f JOIN movement_types t ON t.id = f.movement_type_id
             WHERE f.movement_date LIKE ? AND t.name = 'Insumos'
         ) x GROUP BY month`,
        [yearLike, yearLike, yearLike],
      ),
      queryAll(
        db,
        `SELECT pm.name AS method, SUM(x.total) AS total FROM (
           SELECT payment_method_id, total_amount AS total FROM inventory_entries WHERE movement_date LIKE ?
           UNION ALL
           SELECT f.payment_method_id, f.amount FROM financial_transactions f JOIN movement_types t ON t.id = f.movement_type_id
             WHERE f.movement_date LIKE ? AND t.name IN ('Insumos', 'Despesa')
         ) x JOIN payment_methods pm ON pm.id = x.payment_method_id GROUP BY pm.name`,
        [yearLike, yearLike],
      ),
    ]);

    // Despesas e insumos agrupados por descrição (ex.: Mão de obra, Entrega, Topper)
    const byDescription = new Map<string, { label: string; type: string; total: number; count: number }>();
    expenses.forEach((row) => {
      const label = normalizeDescription(String(row.description));
      const key = `${row.type_name}|${label}`;
      const current = byDescription.get(key) || { label, type: String(row.type_name), total: 0, count: 0 };
      current.total += num(row.total);
      current.count += num(row.n);
      byDescription.set(key, current);
    });

    // CMV do ano por item e por categoria
    const cmvByItem = new Map<number, { name: string; category: string; cmv: number; used: number }>();
    monthly.forEach((month) =>
      month.items.forEach((item) => {
        if (!item.cmv) return;
        const current = cmvByItem.get(item.id) || { name: item.name, category: item.categoryName, cmv: 0, used: 0 };
        current.cmv += item.cmv;
        current.used += item.usageQty;
        cmvByItem.set(item.id, current);
      }),
    );
    const cmvByCategory = new Map<string, number>();
    cmvByItem.forEach((item) => cmvByCategory.set(item.category, (cmvByCategory.get(item.category) || 0) + item.cmv));

    return {
      period,
      year,
      monthly: monthly.map(({ month, label, summary }) => ({ month, label, summary })),
      expenses: Array.from(byDescription.values()).sort((a, b) => b.total - a.total),
      revenueByMethod: revenueByMethod.map((row) => ({ method: String(row.method), month: num(row.month), total: num(row.total) })),
      suppliers: suppliers.map((row) => ({
        supplier: String(row.supplier),
        notes: num(row.notes),
        days: num(row.days),
        total: num(row.total),
        firstDate: String(row.first_date),
        lastDate: String(row.last_date),
      })),
      buyDays: buyDays.map((row) => ({ month: num(row.month), days: num(row.days) })),
      paymentSplit: paymentSplit.map((row) => ({ method: String(row.method), total: num(row.total) })),
      cmvByItem: Array.from(cmvByItem.values()).sort((a, b) => b.cmv - a.cmv),
      cmvByCategory: Array.from(cmvByCategory.entries()).map(([category, cmv]) => ({ category, cmv })).sort((a, b) => b.cmv - a.cmv),
    };
  });
}

// Histórico de preço pago por unidade de um item.
export async function getPriceHistory(itemId: number) {
  if (!itemId) return [];
  return withDatabase(async (db) =>
    (
      await queryAll(
        db,
        `SELECT e.movement_date, e.quantity, e.total_amount, s.name AS supplier_name
         FROM inventory_entries e
         LEFT JOIN purchase_items pi ON pi.inventory_entry_id = e.id
         LEFT JOIN purchases pu ON pu.id = pi.purchase_id
         LEFT JOIN suppliers s ON s.id = pu.supplier_id
         WHERE e.item_id = ? AND e.quantity > 0
         ORDER BY e.movement_date, e.id`,
        [itemId],
      )
    ).map((row) => ({
      date: String(row.movement_date),
      quantity: num(row.quantity),
      unitPrice: num(row.total_amount) / num(row.quantity),
      supplier: row.supplier_name ? String(row.supplier_name) : null,
    })),
  );
}
