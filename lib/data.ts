import { withDatabase, withTransaction, dbHelpers, type Db } from "@/lib/db";
import type {
  DashboardSummary,
  EditBundle,
  FinancialTransactionRow,
  InventoryEntryRow,
  InventoryUsageRow,
  ItemCategory,
  ItemMetrics,
  ItemRecord,
  MovementType,
  PaymentMethod,
  PeriodOption,
  PeriodSummary,
  PurchaseAnalysis,
  PurchaseLineRecord,
  PurchaseOverview,
  PurchaseRecord,
  ReportScope,
  ReportSnapshot,
  SearchParams,
  SupplierRecord,
  TransferRow,
} from "@/lib/types";
import { currentYearMonth, monthLabel } from "@/lib/utils";

const { queryAll, queryOne, run, seedLookupId } = dbHelpers;

function numeric(value: unknown) {
  return Number(value || 0);
}

function paramText(params: SearchParams | undefined, key: string) {
  const value = params?.[key];
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function paramNumber(params: SearchParams | undefined, key: string) {
  const value = Number(paramText(params, key));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function toPeriodLabel(year: number, month: number) {
  const label = monthLabel(year, month);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function movementDelta(kind: string, isInflow: boolean, amount: number) {
  if (kind === "asset") {
    return isInflow ? amount : -amount;
  }
  return isInflow ? -amount : amount;
}

function periodBeforeSql(alias = "periods") {
  return `(${alias}.year < ? OR (${alias}.year = ? AND ${alias}.month < ?))`;
}

function periodAtOrBeforeSql(alias = "periods") {
  return `(${alias}.year < ? OR (${alias}.year = ? AND ${alias}.month <= ?))`;
}

function openingColumnForPaymentMethod(methodName: string) {
  const normalized = methodName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalized.includes("pix")) {
    return "opening_bank_balance";
  }

  if (normalized.includes("dinheiro")) {
    return "opening_cash_balance";
  }

  return "opening_card_balance";
}

function parseScope(params?: SearchParams): ReportScope {
  return params?.scope === "year" ? "year" : "month";
}

export async function resolveSelectedPeriod(db: Db, params?: SearchParams) {
  const requestedYear = Number(params?.year);
  const requestedMonth = Number(params?.month);
  if (
    Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2200 &&
    Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12
  ) {
    return ensurePeriod(db, requestedYear, requestedMonth);
  }

  // Sem mês escolhido, abre no mês atual (horário de Brasília).
  const now = currentYearMonth();
  return ensurePeriod(db, now.year, now.month);
}

function activePeriodsSql(orderDirection: "ASC" | "DESC" = "DESC") {
  return `
    SELECT periods.id, periods.year, periods.month, periods.label, periods.is_closed, periods.closed_at
    FROM periods
    WHERE
      EXISTS (SELECT 1 FROM period_snapshots WHERE period_snapshots.period_id = periods.id)
      OR EXISTS (SELECT 1 FROM inventory_opening_balances WHERE inventory_opening_balances.period_id = periods.id)
      OR EXISTS (SELECT 1 FROM inventory_entries WHERE inventory_entries.period_id = periods.id)
      OR EXISTS (SELECT 1 FROM inventory_usages WHERE inventory_usages.period_id = periods.id)
      OR EXISTS (SELECT 1 FROM financial_transactions WHERE financial_transactions.period_id = periods.id)
      OR EXISTS (SELECT 1 FROM account_transfers WHERE account_transfers.period_id = periods.id)
      OR periods.opening_bank_balance <> 0
      OR periods.opening_cash_balance <> 0
      OR periods.opening_card_balance <> 0
    ORDER BY periods.year ${orderDirection}, periods.month ${orderDirection}
  `;
}

async function ensurePeriod(db: Db, year: number, month: number): Promise<PeriodOption> {
  const existing = await queryOne(
    db,
    "SELECT id, year, month, label, is_closed, closed_at FROM periods WHERE year = ? AND month = ?",
    [year, month],
  );
  if (existing) {
    return {
      id: numeric(existing.id),
      year,
      month,
      label: String(existing.label),
      isClosed: numeric(existing.is_closed) === 1,
      closedAt: existing.closed_at == null ? null : String(existing.closed_at),
    };
  }

  const label = toPeriodLabel(year, month);
  await run(
    db,
    `
      INSERT INTO periods (
        year, month, label, opening_bank_balance, opening_cash_balance, opening_card_balance
      ) VALUES (?, ?, ?, 0, 0, 0)
      ON CONFLICT (year, month) DO NOTHING
    `,
    [year, month, label],
  );
  return ensurePeriod(db, year, month);
}

export async function getPeriodsForYear(db: Db, year: number): Promise<PeriodOption[]> {
  return (await queryAll(
    db,
    `
      SELECT periods.id, periods.year, periods.month, periods.label, periods.is_closed, periods.closed_at
      FROM periods
      WHERE periods.year = ?
        AND (
          EXISTS (SELECT 1 FROM period_snapshots WHERE period_snapshots.period_id = periods.id)
          OR EXISTS (SELECT 1 FROM inventory_opening_balances WHERE inventory_opening_balances.period_id = periods.id)
          OR EXISTS (SELECT 1 FROM inventory_entries WHERE inventory_entries.period_id = periods.id)
          OR EXISTS (SELECT 1 FROM inventory_usages WHERE inventory_usages.period_id = periods.id)
          OR EXISTS (SELECT 1 FROM financial_transactions WHERE financial_transactions.period_id = periods.id)
          OR EXISTS (SELECT 1 FROM account_transfers WHERE account_transfers.period_id = periods.id)
          OR periods.opening_bank_balance <> 0
          OR periods.opening_cash_balance <> 0
          OR periods.opening_card_balance <> 0
        )
      ORDER BY periods.month ASC
    `,
    [year],
  )).map((row) => ({
    id: numeric(row.id),
    year: numeric(row.year),
    month: numeric(row.month),
    label: String(row.label),
    isClosed: numeric(row.is_closed) === 1,
    closedAt: row.closed_at == null ? null : String(row.closed_at),
  }));
}

// Movimentos de estoque somados por competência e item. Lidos uma vez por tela e
// reaproveitados no cálculo de todos os meses (o resultado é o mesmo de consultar mês a mês).
async function getStockMovementsByPeriod(db: Db) {
  const [openingRows, entryRows, usageRows] = await Promise.all([
    queryAll(
      db,
      `
        SELECT period_id, item_id, SUM(quantity) AS quantity, SUM(total_value) AS total_value
        FROM inventory_opening_balances
        GROUP BY period_id, item_id
      `,
    ),
    queryAll(
      db,
      `
        SELECT period_id, item_id, SUM(quantity) AS quantity, SUM(total_amount) AS total_amount
        FROM inventory_entries
        GROUP BY period_id, item_id
      `,
    ),
    queryAll(
      db,
      `
        SELECT period_id, item_id, SUM(quantity) AS quantity
        FROM inventory_usages
        GROUP BY period_id, item_id
      `,
    ),
  ]);

  const byPeriod = (rows: Record<string, any>[]) => {
    const map = new Map<number, Record<string, any>[]>();
    rows.forEach((row) => {
      const key = numeric(row.period_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(row);
    });
    return map;
  };

  return {
    openings: byPeriod(openingRows),
    entries: byPeriod(entryRows),
    usages: byPeriod(usageRows),
  };
}

export async function getItemMetricsInternal(db: Db, periodId: number) {
  const targetPeriod = await queryOne(
    db,
    "SELECT id, year, month FROM periods WHERE id = ?",
    [periodId],
  );
  const movements = await getStockMovementsByPeriod(db);

  const items = await queryAll(
    db,
    `
      SELECT
        items.id,
        items.name,
        items.unit_size,
        items.reference_price,
        items.low_stock_threshold,
        items.is_active,
        item_categories.name AS category_name
      FROM items
      LEFT JOIN item_categories ON item_categories.id = items.category_id
      WHERE
        items.is_active = 1
        OR EXISTS (SELECT 1 FROM inventory_opening_balances WHERE inventory_opening_balances.item_id = items.id)
        OR EXISTS (SELECT 1 FROM inventory_entries WHERE inventory_entries.item_id = items.id)
        OR EXISTS (SELECT 1 FROM inventory_usages WHERE inventory_usages.item_id = items.id)
      ORDER BY items.name
    `,
  );

  const openingState = new Map<number, { quantity: number; totalValue: number }>();

  if (targetPeriod) {
    const periodsThroughTarget = await queryAll(
      db,
      `
        SELECT id, year, month
        FROM periods
        WHERE ${periodAtOrBeforeSql("periods")}
        ORDER BY year ASC, month ASC
      `,
      [numeric(targetPeriod.year), numeric(targetPeriod.year), numeric(targetPeriod.month)],
    );

    periodsThroughTarget.some((period) => {
      const currentPeriodId = numeric(period.id);
      const openingRows = movements.openings.get(currentPeriodId) || [];

      openingRows.forEach((row) => {
        const itemId = numeric(row.item_id);
        const state = openingState.get(itemId) || { quantity: 0, totalValue: 0 };
        state.quantity += numeric(row.quantity);
        state.totalValue += numeric(row.total_value);
        openingState.set(itemId, state);
      });

      if (currentPeriodId === periodId) {
        return true;
      }

      const previousEntries = movements.entries.get(currentPeriodId) || [];

      previousEntries.forEach((row) => {
        const itemId = numeric(row.item_id);
        const state = openingState.get(itemId) || { quantity: 0, totalValue: 0 };
        state.quantity += numeric(row.quantity);
        state.totalValue += numeric(row.total_amount);
        openingState.set(itemId, state);
      });

      const previousUsages = movements.usages.get(currentPeriodId) || [];

      previousUsages.forEach((row) => {
        const itemId = numeric(row.item_id);
        const state = openingState.get(itemId) || { quantity: 0, totalValue: 0 };
        const averageCost = state.quantity > 0 ? state.totalValue / state.quantity : 0;
        const usageQty = numeric(row.quantity);
        state.quantity -= usageQty;
        state.totalValue -= usageQty * averageCost;
        openingState.set(itemId, state);
      });

      return false;
    });
  }

  const entries = new Map(
    (movements.entries.get(periodId) || []).map((row) => [numeric(row.item_id), row]),
  );

  const usages = new Map(
    (movements.usages.get(periodId) || []).map((row) => [numeric(row.item_id), row]),
  );

  return items.map((item): ItemMetrics => {
    const opening = openingState.get(numeric(item.id));
    const entry = entries.get(numeric(item.id));
    const usage = usages.get(numeric(item.id));

    const openingQty = numeric(opening?.quantity);
    const openingValue = numeric(opening?.totalValue);
    const entriesQty = numeric(entry?.quantity);
    const entriesValue = numeric(entry?.total_amount);
    const availableQty = openingQty + entriesQty;
    const availableValue = openingValue + entriesValue;
    const averageCost = availableQty > 0 ? availableValue / availableQty : 0;
    const usageQty = numeric(usage?.quantity);
    const cmv = usageQty * averageCost;
    const finalQty = availableQty - usageQty;
    const finalValue = availableValue - cmv;
    const finalAverageCost = finalQty > 0 ? finalValue / finalQty : 0;

    return {
      id: numeric(item.id),
      name: String(item.name),
      categoryName: String(item.category_name || "Sem categoria"),
      isActive: numeric(item.is_active) === 1,
      unitSize: item.unit_size == null ? null : numeric(item.unit_size),
      referencePrice: item.reference_price == null ? null : numeric(item.reference_price),
      openingQty,
      openingValue,
      entriesQty,
      entriesValue,
      availableQty,
      availableValue,
      averageCost,
      usageQty,
      cmv,
      finalQty,
      finalValue,
      finalAverageCost,
      lowStockThreshold: numeric(item.low_stock_threshold),
    };
  });
}

// Movimentos das contas somados por competência. Lidos uma vez por tela.
async function getAccountMovementsByPeriod(db: Db) {
  const [entryRows, financialRows, transferRows] = await Promise.all([
    queryAll(
      db,
      `
        SELECT periods.year, periods.month, inventory_entries.payment_method_id,
          SUM(inventory_entries.total_amount) AS total_amount
        FROM inventory_entries
        INNER JOIN periods ON periods.id = inventory_entries.period_id
        GROUP BY periods.year, periods.month, inventory_entries.payment_method_id
      `,
    ),
    queryAll(
      db,
      `
        SELECT periods.year, periods.month, financial_transactions.payment_method_id,
          movement_types.group_name, SUM(financial_transactions.amount) AS total_amount
        FROM financial_transactions
        INNER JOIN periods ON periods.id = financial_transactions.period_id
        INNER JOIN movement_types ON movement_types.id = financial_transactions.movement_type_id
        GROUP BY periods.year, periods.month, financial_transactions.payment_method_id, movement_types.group_name
      `,
    ),
    queryAll(
      db,
      `
        SELECT periods.year, periods.month, account_transfers.from_payment_method_id,
          account_transfers.to_payment_method_id, SUM(account_transfers.amount) AS total_amount
        FROM account_transfers
        INNER JOIN periods ON periods.id = account_transfers.period_id
        GROUP BY periods.year, periods.month, account_transfers.from_payment_method_id, account_transfers.to_payment_method_id
      `,
    ),
  ]);
  return { entryRows, financialRows, transferRows };
}

async function getPaymentMethodMovementBeforePeriod(db: Db, method: PaymentMethod, year: number, month: number) {
  const { entryRows, financialRows, transferRows } = await getAccountMovementsByPeriod(db);
  const isBefore = (row: Record<string, any>) =>
    numeric(row.year) < year || (numeric(row.year) === year && numeric(row.month) < month);
  const total = (rows: Record<string, any>[]) =>
    rows.reduce((sum, row) => sum + numeric(row.total_amount), 0);
  let movement = 0;

  const stockEntries = total(
    entryRows.filter((row) => numeric(row.payment_method_id) === method.id && isBefore(row)),
  );
  movement += movementDelta(method.kind, false, stockEntries);

  const financialByGroup = new Map<string, Record<string, any>[]>();
  financialRows
    .filter((row) => numeric(row.payment_method_id) === method.id && isBefore(row))
    .forEach((row) => {
      const group = String(row.group_name);
      if (!financialByGroup.has(group)) financialByGroup.set(group, []);
      financialByGroup.get(group)?.push(row);
    });

  financialByGroup.forEach((rows, group) => {
    movement += movementDelta(method.kind, group === "income", total(rows));
  });

  const transfersOut = total(
    transferRows.filter((row) => numeric(row.from_payment_method_id) === method.id && isBefore(row)),
  );
  movement += movementDelta(method.kind, false, transfersOut);

  const transfersIn = total(
    transferRows.filter((row) => numeric(row.to_payment_method_id) === method.id && isBefore(row)),
  );
  movement += movementDelta(method.kind, true, transfersIn);

  return movement;
}

async function getBalanceRowsInternal(db: Db, periodId: number) {
  const period = await queryOne(
    db,
    `
      SELECT year, month, opening_bank_balance, opening_cash_balance, opening_card_balance
      FROM periods WHERE id = ?
    `,
    [periodId],
  );

  const paymentMethods = (await queryAll(
    db,
    "SELECT id, name, kind FROM payment_methods ORDER BY kind, name",
  )) as PaymentMethod[];

  const balances = paymentMethods.map((method) => ({
    paymentMethod: String(method.name),
    kind: method.kind,
    opening: 0,
    movement: 0,
    final: 0,
  }));

  const balanceMap = new Map(balances.map((row) => [row.paymentMethod, row]));

  if (period) {
    for (const method of paymentMethods) {
      const target = balanceMap.get(String(method.name));
      if (!target) continue;

      const openingColumn = openingColumnForPaymentMethod(String(method.name));
      const opening = await queryOne(
        db,
        `
          SELECT SUM(${openingColumn}) AS opening_balance
          FROM periods
          WHERE ${periodAtOrBeforeSql("periods")}
        `,
        [numeric(period.year), numeric(period.year), numeric(period.month)],
      );

      target.opening =
        numeric(opening?.opening_balance) +
        (await getPaymentMethodMovementBeforePeriod(
          db,
          {
            id: numeric(method.id),
            name: String(method.name),
            kind: method.kind,
          },
          numeric(period.year),
          numeric(period.month),
        ));
    }
  }

  const stockEntries = await queryAll(
    db,
    `
      SELECT payment_methods.name, payment_methods.kind, SUM(inventory_entries.total_amount) AS total_amount
      FROM inventory_entries
      INNER JOIN payment_methods ON payment_methods.id = inventory_entries.payment_method_id
      WHERE inventory_entries.period_id = ?
      GROUP BY payment_methods.name, payment_methods.kind
    `,
    [periodId],
  );

  stockEntries.forEach((row) => {
    const target = balanceMap.get(String(row.name));
    if (!target) return;
    target.movement += movementDelta(String(row.kind), false, numeric(row.total_amount));
  });

  const financialTransactions = await queryAll(
    db,
    `
      SELECT payment_methods.name, payment_methods.kind, movement_types.group_name, SUM(financial_transactions.amount) AS total_amount
      FROM financial_transactions
      INNER JOIN payment_methods ON payment_methods.id = financial_transactions.payment_method_id
      INNER JOIN movement_types ON movement_types.id = financial_transactions.movement_type_id
      WHERE financial_transactions.period_id = ?
      GROUP BY payment_methods.name, payment_methods.kind, movement_types.group_name
    `,
    [periodId],
  );

  financialTransactions.forEach((row) => {
    const target = balanceMap.get(String(row.name));
    if (!target) return;
    const inflow = row.group_name === "income";
    target.movement += movementDelta(String(row.kind), inflow, numeric(row.total_amount));
  });

  const transfers = await queryAll(
    db,
    `
      SELECT
        from_methods.name AS from_name,
        from_methods.kind AS from_kind,
        to_methods.name AS to_name,
        to_methods.kind AS to_kind,
        account_transfers.amount
      FROM account_transfers
      INNER JOIN payment_methods AS from_methods ON from_methods.id = account_transfers.from_payment_method_id
      INNER JOIN payment_methods AS to_methods ON to_methods.id = account_transfers.to_payment_method_id
      WHERE account_transfers.period_id = ?
    `,
    [periodId],
  );

  transfers.forEach((row) => {
    const fromTarget = balanceMap.get(String(row.from_name));
    const toTarget = balanceMap.get(String(row.to_name));
    const amount = numeric(row.amount);
    if (fromTarget) {
      fromTarget.movement += movementDelta(String(row.from_kind), false, amount);
    }
    if (toTarget) {
      toTarget.movement += movementDelta(String(row.to_kind), true, amount);
    }
  });

  balances.forEach((row) => {
    row.final = row.opening + row.movement;
  });

  return balances;
}

async function getDynamicPeriodSummary(db: Db, periodId: number) {
  const itemMetrics = await getItemMetricsInternal(db, periodId);
  const balances = await getBalanceRowsInternal(db, periodId);
  const totals = await queryAll(
    db,
    `
      SELECT movement_types.name, SUM(financial_transactions.amount) AS total_amount
      FROM financial_transactions
      INNER JOIN movement_types ON movement_types.id = financial_transactions.movement_type_id
      WHERE financial_transactions.period_id = ?
      GROUP BY movement_types.name
    `,
    [periodId],
  );

  const revenue = numeric(totals.find((row) => row.name === "Receita")?.total_amount);
  const inputs = numeric(totals.find((row) => row.name === "Insumos")?.total_amount);
  const expenses = numeric(totals.find((row) => row.name === "Despesa")?.total_amount);
  const withdrawals = numeric(totals.find((row) => row.name === "Retirada")?.total_amount);
  const cmv = itemMetrics.reduce((sum, item) => sum + item.cmv, 0);
  const stockValue = itemMetrics.reduce((sum, item) => sum + item.finalValue, 0);
  const availableBalance = balances.reduce((sum, row) => {
    return row.kind === "asset" ? sum + row.final : sum - row.final;
  }, 0);
  const netProfit = revenue - cmv - inputs - expenses;
  const result = netProfit - withdrawals;

  return {
    summary: {
      revenue,
      cmv,
      inputs,
      expenses,
      netProfit,
      withdrawals,
      result,
      stockValue,
      availableBalance,
      source: "dynamic" as const,
    },
    balances,
    itemMetrics,
  };
}

async function getSnapshotSummary(db: Db, periodId: number) {
  const row = await queryOne(
    db,
    `
      SELECT
        revenue,
        cmv,
        inputs,
        expenses,
        net_profit,
        withdrawals,
        result,
        stock_value,
        available_balance
      FROM period_snapshots
      WHERE period_id = ?
    `,
    [periodId],
  );
  if (!row) {
    return null;
  }

  return {
    revenue: numeric(row.revenue),
    cmv: numeric(row.cmv),
    inputs: numeric(row.inputs),
    expenses: numeric(row.expenses),
    netProfit: numeric(row.net_profit),
    withdrawals: numeric(row.withdrawals),
    result: numeric(row.result),
    stockValue: row.stock_value == null ? 0 : numeric(row.stock_value),
    availableBalance: row.available_balance == null ? 0 : numeric(row.available_balance),
    source: "snapshot" as const,
  };
}

async function hasImportedOperationalDetail(db: Db, periodId: number) {
  const row = await queryOne(
    db,
    `
      SELECT
        (SELECT COUNT(*) FROM inventory_opening_balances WHERE period_id = ?) +
        (SELECT COUNT(*) FROM inventory_entries WHERE period_id = ? AND source = 'imported_excel') +
        (SELECT COUNT(*) FROM inventory_usages WHERE period_id = ? AND source = 'imported_excel') +
        (SELECT COUNT(*) FROM financial_transactions WHERE period_id = ? AND source = 'imported_excel') +
        (SELECT COUNT(*) FROM account_transfers WHERE period_id = ? AND source = 'imported_excel') AS total
    `,
    [periodId, periodId, periodId, periodId, periodId],
  );

  return numeric(row?.total) > 0;
}

async function hasOperationalActivity(db: Db, periodId: number) {
  const row = await queryOne(
    db,
    `
      SELECT
        (SELECT COUNT(*) FROM inventory_entries WHERE period_id = ?) +
        (SELECT COUNT(*) FROM inventory_usages WHERE period_id = ?) +
        (SELECT COUNT(*) FROM financial_transactions WHERE period_id = ?) +
        (SELECT COUNT(*) FROM account_transfers WHERE period_id = ?) AS total
    `,
    [periodId, periodId, periodId, periodId],
  );

  return numeric(row?.total) > 0;
}

export async function getResolvedPeriodData(db: Db, periodId: number) {
  const dynamicData = await getDynamicPeriodSummary(db, periodId);
  const snapshot = await getSnapshotSummary(db, periodId);
  const importedOperationalDetail = await hasImportedOperationalDetail(db, periodId);
  const operationalActivity = await hasOperationalActivity(db, periodId);
  const hasOperationalDetail = dynamicData.itemMetrics.some(
    (item) =>
      item.openingQty !== 0 ||
      item.entriesQty !== 0 ||
      item.usageQty !== 0 ||
      item.finalQty !== 0 ||
      item.finalValue !== 0,
  );

  const summary: PeriodSummary = snapshot
    ? importedOperationalDetail
      ? dynamicData.summary
      : operationalActivity
        ? {
            revenue: snapshot.revenue + dynamicData.summary.revenue,
            cmv: snapshot.cmv + dynamicData.summary.cmv,
            inputs: snapshot.inputs + dynamicData.summary.inputs,
            expenses: snapshot.expenses + dynamicData.summary.expenses,
            netProfit:
              snapshot.netProfit +
              (dynamicData.summary.revenue -
                dynamicData.summary.cmv -
                dynamicData.summary.inputs -
                dynamicData.summary.expenses),
            withdrawals: snapshot.withdrawals + dynamicData.summary.withdrawals,
            result:
              snapshot.result +
              (dynamicData.summary.revenue -
                dynamicData.summary.cmv -
                dynamicData.summary.inputs -
                dynamicData.summary.expenses -
                dynamicData.summary.withdrawals),
            stockValue: dynamicData.summary.stockValue || snapshot.stockValue,
            availableBalance: dynamicData.summary.availableBalance || snapshot.availableBalance,
            source: "dynamic",
          }
        : {
        revenue: snapshot.revenue,
        cmv: snapshot.cmv,
        inputs: snapshot.inputs,
        expenses: snapshot.expenses,
        netProfit: snapshot.netProfit,
        withdrawals: snapshot.withdrawals,
        result: snapshot.result,
        stockValue: dynamicData.summary.stockValue || snapshot.stockValue,
        availableBalance: dynamicData.summary.availableBalance || snapshot.availableBalance,
        source: "snapshot",
      }
    : dynamicData.summary;

  return {
    summary,
    balances: dynamicData.balances,
    itemMetrics: dynamicData.itemMetrics,
    hasOperationalDetail,
  };
}

function buildDre(summary: PeriodSummary) {
  const netProfitLabel = summary.netProfit >= 0 ? "Lucro líquido" : "Prejuízo líquido";

  return [
    { label: "Receita", value: summary.revenue },
    { label: "CMV", value: -summary.cmv },
    { label: "Insumos", value: -summary.inputs },
    { label: "Despesas", value: -summary.expenses },
    { label: netProfitLabel, value: summary.netProfit },
    { label: "Retiradas", value: -summary.withdrawals },
    { label: "Resultado final", value: summary.result },
  ];
}

function sumSummaries(rows: PeriodSummary[]): PeriodSummary {
  return rows.reduce(
    (acc, row) => ({
      revenue: acc.revenue + row.revenue,
      cmv: acc.cmv + row.cmv,
      inputs: acc.inputs + row.inputs,
      expenses: acc.expenses + row.expenses,
      netProfit: acc.netProfit + row.netProfit,
      withdrawals: acc.withdrawals + row.withdrawals,
      result: acc.result + row.result,
      stockValue: row.stockValue,
      availableBalance: row.availableBalance,
      source: acc.source === "snapshot" && row.source === "snapshot" ? "snapshot" : "dynamic",
    }),
    {
      revenue: 0,
      cmv: 0,
      inputs: 0,
      expenses: 0,
      netProfit: 0,
      withdrawals: 0,
      result: 0,
      stockValue: 0,
      availableBalance: 0,
      source: "snapshot" as const,
    },
  );
}

export async function getPeriodContext(params?: SearchParams) {
  return withDatabase(async (db) => {
    const selected = await resolveSelectedPeriod(db, params);
    const options = (await queryAll(db, activePeriodsSql("DESC"))).map((row) => ({
      id: numeric(row.id),
      year: numeric(row.year),
      month: numeric(row.month),
      label: String(row.label),
      isClosed: numeric(row.is_closed) === 1,
      closedAt: row.closed_at == null ? null : String(row.closed_at),
    })) as PeriodOption[];
    if (!options.some((option) => option.id === selected.id)) {
      options.unshift(selected);
    }
    return { selected, options, scope: parseScope(params) };
  });
}

export async function getPaymentMethods() {
  return withDatabase(async (db) =>
    (await queryAll(
      db,
      "SELECT id, name, kind FROM payment_methods ORDER BY CASE kind WHEN 'asset' THEN 0 ELSE 1 END, name",
    ) as PaymentMethod[]).map((row) => ({
      id: numeric(row.id),
      name: String(row.name),
      kind: row.kind,
    })),
  );
}

export async function getMovementTypes() {
  return withDatabase(async (db) =>
    (await queryAll(
      db,
      "SELECT id, name, group_name, affects_report FROM movement_types ORDER BY id",
    ) as MovementType[]).map((row) => ({
      id: numeric(row.id),
      name: String(row.name),
      group_name: row.group_name,
      affects_report: numeric(row.affects_report),
    })),
  );
}

export async function getPurchaseMovementTypes() {
  return withDatabase(async (db) =>
    (await queryAll(
      db,
      `
        SELECT id, name, group_name, affects_report
        FROM movement_types
        WHERE name IN ('Insumos', 'Despesa')
        ORDER BY CASE name WHEN 'Insumos' THEN 0 ELSE 1 END
      `,
    ) as MovementType[]).map((row) => ({
      id: numeric(row.id),
      name: String(row.name),
      group_name: row.group_name,
      affects_report: numeric(row.affects_report),
    })),
  );
}

export async function getItemCategories() {
  return withDatabase(async (db) =>
    (await queryAll(db, "SELECT id, name FROM item_categories ORDER BY name") as ItemCategory[]).map(
      (row) => ({
        id: numeric(row.id),
        name: String(row.name),
      }),
    ),
  );
}

export async function getItems(options?: { status?: "active" | "archived" | "all" }) {
  return withDatabase(async (db) =>
    (await queryAll(
      db,
      `
        SELECT
          items.id,
          items.name,
          items.category_id,
          items.unit_size,
          items.reference_price,
          items.price_per_kg,
          items.low_stock_threshold,
        items.notes,
        items.is_active,
        item_categories.name AS category_name
      FROM items
      LEFT JOIN item_categories ON item_categories.id = items.category_id
      ${
        options?.status === "archived"
          ? "WHERE items.is_active = 0"
          : options?.status === "all"
            ? ""
            : "WHERE items.is_active = 1"
      }
      ORDER BY items.name
    `,
    )).map((row): ItemRecord => ({
      id: numeric(row.id),
      name: String(row.name),
      category_id: row.category_id == null ? null : numeric(row.category_id),
      category_name: row.category_name == null ? null : String(row.category_name),
      unit_size: row.unit_size == null ? null : numeric(row.unit_size),
      reference_price: row.reference_price == null ? null : numeric(row.reference_price),
      price_per_kg: row.price_per_kg == null ? null : numeric(row.price_per_kg),
      low_stock_threshold: numeric(row.low_stock_threshold),
      notes: row.notes == null ? null : String(row.notes),
      is_active: numeric(row.is_active),
    })),
  );
}

export async function getSuppliers(options?: { status?: "active" | "archived" | "all" }) {
  return withDatabase(async (db) =>
    (await queryAll(
      db,
      `
        SELECT id, name, contact, notes, is_active
        FROM suppliers
        ${
          options?.status === "archived"
            ? "WHERE is_active = 0"
            : options?.status === "all"
              ? ""
              : "WHERE is_active = 1"
        }
        ORDER BY is_active DESC, name
      `,
    )).map((row): SupplierRecord => ({
      id: numeric(row.id),
      name: String(row.name),
      contact: row.contact == null ? null : String(row.contact),
      notes: row.notes == null ? null : String(row.notes),
      is_active: numeric(row.is_active),
    })),
  );
}

async function purchaseLinesForRecord(db: Db, purchaseId: number): Promise<PurchaseLineRecord[]> {
  return (await queryAll(
    db,
    `
      SELECT
        purchase_items.id,
        purchase_items.destination,
        purchase_items.item_id,
        items.name AS item_name,
        purchase_items.description,
        purchase_items.quantity,
        purchase_items.total_amount,
        purchase_items.movement_type_id,
        movement_types.name AS movement_type_name,
        purchase_items.inventory_entry_id,
        purchase_items.financial_transaction_id
      FROM purchase_items
      LEFT JOIN items ON items.id = purchase_items.item_id
      LEFT JOIN movement_types ON movement_types.id = purchase_items.movement_type_id
      WHERE purchase_items.purchase_id = ?
      ORDER BY purchase_items.id
    `,
    [purchaseId],
  )).map((row) => ({
    id: numeric(row.id),
    destination: String(row.destination) as PurchaseLineRecord["destination"],
    item_id: row.item_id == null ? null : numeric(row.item_id),
    item_name: row.item_name == null ? null : String(row.item_name),
    description: String(row.description),
    quantity: numeric(row.quantity),
    total_amount: numeric(row.total_amount),
    movement_type_id: row.movement_type_id == null ? null : numeric(row.movement_type_id),
    movement_type_name: row.movement_type_name == null ? null : String(row.movement_type_name),
    inventory_entry_id:
      row.inventory_entry_id == null ? null : numeric(row.inventory_entry_id),
    financial_transaction_id:
      row.financial_transaction_id == null ? null : numeric(row.financial_transaction_id),
  }));
}

export async function getPurchases(params?: SearchParams) {
  return withDatabase(async (db) => {
    const selected = await resolveSelectedPeriod(db, params);
    const queryParams: any[] = [selected.id];
    const filters = ["purchases.period_id = ?"];
    const supplierId = paramNumber(params, "supplierId");
    const destination = paramText(params, "destination");
    const search = paramText(params, "q");

    if (supplierId) {
      filters.push("purchases.supplier_id = ?");
      queryParams.push(supplierId);
    }
    if (destination === "inventory" || destination === "financial") {
      filters.push("EXISTS (SELECT 1 FROM purchase_items filtered_items WHERE filtered_items.purchase_id = purchases.id AND filtered_items.destination = ?)");
      queryParams.push(destination);
    }
    if (search) {
      filters.push("(suppliers.name ILIKE ? OR purchases.invoice_number ILIKE ? OR purchases.notes ILIKE ? OR EXISTS (SELECT 1 FROM purchase_items searched_items WHERE searched_items.purchase_id = purchases.id AND searched_items.description ILIKE ?))");
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    return (await queryAll(
      db,
      `
        SELECT
          purchases.id,
          purchases.period_id,
          purchases.purchase_date,
          purchases.supplier_id,
          suppliers.name AS supplier_name,
          purchases.payment_method_id,
          payment_methods.name AS payment_method_name,
          purchases.invoice_number,
          purchases.notes,
          COUNT(purchase_items.id) AS line_count,
          COALESCE(SUM(purchase_items.total_amount), 0) AS total_amount,
          COALESCE(SUM(CASE WHEN purchase_items.destination = 'inventory' THEN purchase_items.total_amount ELSE 0 END), 0) AS inventory_amount,
          COALESCE(SUM(CASE WHEN purchase_items.destination = 'financial' THEN purchase_items.total_amount ELSE 0 END), 0) AS financial_amount
        FROM purchases
        INNER JOIN suppliers ON suppliers.id = purchases.supplier_id
        INNER JOIN payment_methods ON payment_methods.id = purchases.payment_method_id
        INNER JOIN purchase_items ON purchase_items.purchase_id = purchases.id
        WHERE ${filters.join(" AND ")}
        GROUP BY purchases.id, suppliers.name, payment_methods.name
        ORDER BY purchases.purchase_date DESC, purchases.id DESC
      `,
      queryParams,
    )).map((row): PurchaseRecord => ({
      id: numeric(row.id),
      period_id: numeric(row.period_id),
      purchase_date: String(row.purchase_date),
      supplier_id: numeric(row.supplier_id),
      supplier_name: String(row.supplier_name),
      payment_method_id: numeric(row.payment_method_id),
      payment_method_name: String(row.payment_method_name),
      invoice_number: row.invoice_number == null ? null : String(row.invoice_number),
      notes: row.notes == null ? null : String(row.notes),
      total_amount: numeric(row.total_amount),
      inventory_amount: numeric(row.inventory_amount),
      financial_amount: numeric(row.financial_amount),
      line_count: numeric(row.line_count),
    }));
  });
}

export async function getPurchaseForEdit(purchaseId: number) {
  if (!purchaseId) return null;
  return withDatabase(async (db) => {
    const row = await queryOne(
      db,
      `
        SELECT purchases.*, suppliers.name AS supplier_name,
          payment_methods.name AS payment_method_name
        FROM purchases
        INNER JOIN suppliers ON suppliers.id = purchases.supplier_id
        INNER JOIN payment_methods ON payment_methods.id = purchases.payment_method_id
        WHERE purchases.id = ?
      `,
      [purchaseId],
    );
    if (!row) return null;
    const lines = await purchaseLinesForRecord(db, purchaseId);
    const inventoryAmount = lines
      .filter((line) => line.destination === "inventory")
      .reduce((sum, line) => sum + line.total_amount, 0);
    const financialAmount = lines
      .filter((line) => line.destination === "financial")
      .reduce((sum, line) => sum + line.total_amount, 0);
    return {
      id: numeric(row.id),
      period_id: numeric(row.period_id),
      purchase_date: String(row.purchase_date),
      supplier_id: numeric(row.supplier_id),
      supplier_name: String(row.supplier_name),
      payment_method_id: numeric(row.payment_method_id),
      payment_method_name: String(row.payment_method_name),
      invoice_number: row.invoice_number == null ? null : String(row.invoice_number),
      notes: row.notes == null ? null : String(row.notes),
      total_amount: inventoryAmount + financialAmount,
      inventory_amount: inventoryAmount,
      financial_amount: financialAmount,
      line_count: lines.length,
      lines,
    } satisfies PurchaseRecord;
  });
}

export async function getPurchaseOverview(params?: SearchParams): Promise<PurchaseOverview> {
  return withDatabase(async (db) => {
    const selected = await resolveSelectedPeriod(db, params);
    const row = await queryOne(
      db,
      `
        SELECT
          COUNT(DISTINCT purchases.id) AS purchase_count,
          COALESCE(SUM(purchase_items.total_amount), 0) AS total_amount,
          COALESCE(SUM(CASE WHEN purchase_items.destination = 'inventory' THEN purchase_items.total_amount ELSE 0 END), 0) AS inventory_amount,
          COALESCE(SUM(CASE WHEN purchase_items.destination = 'financial' THEN purchase_items.total_amount ELSE 0 END), 0) AS financial_amount
        FROM purchases
        LEFT JOIN purchase_items ON purchase_items.purchase_id = purchases.id
        WHERE purchases.period_id = ?
      `,
      [selected.id],
    );
    const supplierRow = await queryOne(db, "SELECT COUNT(*) AS count FROM suppliers WHERE is_active = 1");
    return {
      purchaseCount: numeric(row?.purchase_count),
      totalAmount: numeric(row?.total_amount),
      inventoryAmount: numeric(row?.inventory_amount),
      financialAmount: numeric(row?.financial_amount),
      activeSupplierCount: numeric(supplierRow?.count),
    };
  });
}

export async function getPurchaseAnalysis(params?: SearchParams): Promise<PurchaseAnalysis> {
  return withDatabase(async (db) => {
    const selected = await resolveSelectedPeriod(db, params);
    const periodKeys = (await queryAll(
      db,
      `
        SELECT DISTINCT periods.year::text || '-' || lpad(periods.month::text, 2, '0') AS period_key
        FROM inventory_usages
        INNER JOIN periods ON periods.id = inventory_usages.period_id
        WHERE periods.year = ? AND periods.month <= ?
        ORDER BY period_key
      `,
      [selected.year, selected.month],
    )).map((row) => String(row.period_key));

    const entryRows = await queryAll(
      db,
      `
        SELECT inventory_entries.item_id, items.name AS item_name,
          inventory_entries.movement_date, inventory_entries.quantity,
          inventory_entries.total_amount
        FROM inventory_entries
        INNER JOIN items ON items.id = inventory_entries.item_id
        INNER JOIN periods ON periods.id = inventory_entries.period_id
        WHERE periods.year = ? AND periods.month <= ?
        ORDER BY inventory_entries.item_id, inventory_entries.movement_date
      `,
      [selected.year, selected.month],
    );
    const usageRows = await queryAll(
      db,
      `
        SELECT inventory_usages.item_id,
          periods.year::text || '-' || lpad(periods.month::text, 2, '0') AS period_key,
          SUM(inventory_usages.quantity) AS quantity
        FROM inventory_usages
        INNER JOIN periods ON periods.id = inventory_usages.period_id
        WHERE periods.year = ? AND periods.month <= ?
        GROUP BY inventory_usages.item_id, periods.year, periods.month
      `,
      [selected.year, selected.month],
    );
    const latestCount = await queryOne(
      db,
      "SELECT MAX(movement_date) AS latest FROM inventory_usages WHERE period_id = ?",
      [selected.id],
    );
    const latestCountDate = latestCount?.latest == null ? null : String(latestCount.latest);
    const lastDay = new Date(Date.UTC(selected.year, selected.month, 0)).getUTCDate();
    const latestDay = latestCountDate ? Number(latestCountDate.slice(8, 10)) : 0;
    const currentMetrics = new Map(
      (await getItemMetricsInternal(db, selected.id)).map((metric) => [metric.id, metric]),
    );

    const usageByItem = new Map<number, Map<string, number>>();
    usageRows.forEach((row) => {
      const itemId = numeric(row.item_id);
      if (!usageByItem.has(itemId)) usageByItem.set(itemId, new Map());
      usageByItem.get(itemId)?.set(String(row.period_key), numeric(row.quantity));
    });

    const entriesByItem = new Map<number, typeof entryRows>();
    entryRows.forEach((row) => {
      const itemId = numeric(row.item_id);
      if (!entriesByItem.has(itemId)) entriesByItem.set(itemId, []);
      entriesByItem.get(itemId)?.push(row);
    });

    const insights = Array.from(entriesByItem.entries())
      .map(([itemId, rows]) => {
        const purchaseDates = Array.from(new Set(rows.map((row) => String(row.movement_date)))).sort();
        const closePurchaseIntervals = purchaseDates.slice(1).filter((date, index) => {
          const before = Date.parse(purchaseDates[index]);
          const after = Date.parse(date);
          return Math.round((after - before) / 86_400_000) <= 7;
        }).length;
        const usages = usageByItem.get(itemId) || new Map<string, number>();
        const usageMonths = Array.from(usages.values()).filter((value) => value > 0).length;
        const averageMonthlyUsage = periodKeys.length
          ? periodKeys.reduce((sum, key) => sum + (usages.get(key) || 0), 0) / periodKeys.length
          : 0;
        const unitPrices = rows
          .filter((row) => numeric(row.quantity) > 0)
          .map((row) => numeric(row.total_amount) / numeric(row.quantity));

        return {
          itemId,
          itemName: String(rows[0]?.item_name || "Item"),
          purchaseDays: purchaseDates.length,
          closePurchaseIntervals,
          usageMonths,
          averageMonthlyUsage,
          currentQuantity: currentMetrics.get(itemId)?.finalQty || 0,
          minimumUnitPrice: unitPrices.length ? Math.min(...unitPrices) : 0,
          maximumUnitPrice: unitPrices.length ? Math.max(...unitPrices) : 0,
          confidence: usageMonths >= 3 ? "high" : usageMonths === 2 ? "medium" : "low",
        } satisfies PurchaseAnalysis["insights"][number];
      })
      .filter((insight) => insight.purchaseDays >= 2 && insight.usageMonths >= 2)
      .sort(
        (left, right) =>
          right.closePurchaseIntervals - left.closePurchaseIntervals ||
          right.purchaseDays - left.purchaseDays ||
          right.averageMonthlyUsage - left.averageMonthlyUsage,
      )
      .slice(0, 8);

    return {
      isCurrentPeriodPartial: latestCountDate == null || latestDay < lastDay,
      latestCountDate,
      insights,
    };
  });
}

export async function getItemMetrics(params?: SearchParams) {
  return withDatabase(async (db) => {
    const selected = await resolveSelectedPeriod(db, params);
    return await getItemMetricsInternal(db, selected.id);
  });
}

export async function getDashboardSummary(params?: SearchParams): Promise<DashboardSummary> {
  return withDatabase(async (db) => {
    const selected = await resolveSelectedPeriod(db, params);
    const scope = parseScope(params);
    const resolved = await getResolvedPeriodData(db, selected.id);
    const yearPeriods = await getPeriodsForYear(db, selected.year);
    const referencePeriod =
      scope === "year" && yearPeriods.length ? yearPeriods[yearPeriods.length - 1] : selected;
    const referenceResolved = await getResolvedPeriodData(db, referencePeriod.id);
    const monthlyRows: { period: PeriodOption; summary: PeriodSummary }[] = [];
    for (const period of yearPeriods) {
      monthlyRows.push({ period, summary: (await getResolvedPeriodData(db, period.id)).summary });
    }
    const annualTotals = sumSummaries(monthlyRows.map((row) => row.summary));
    const activeSummary = scope === "year" ? annualTotals : resolved.summary;

    const lowStockItems = referenceResolved.itemMetrics
      .filter((item) => item.isActive)
      .filter((item) => referenceResolved.hasOperationalDetail)
      .filter((item) => item.lowStockThreshold > 0 && item.finalQty <= item.lowStockThreshold)
      .sort((a, b) => a.finalQty - b.finalQty)
      .slice(0, 8);

    return {
      period: selected,
      scope,
      summarySource: activeSummary.source,
      hasOperationalDetail: referenceResolved.hasOperationalDetail,
      metrics: [
        { label: "Receita", value: activeSummary.revenue, note: "Entradas financeiras do periodo" },
        { label: "CMV", value: activeSummary.cmv, note: "Custo da mercadoria vendida" },
        { label: "Insumos", value: activeSummary.inputs, note: "Compras registradas como insumos" },
        { label: "Despesas", value: activeSummary.expenses, note: "Gastos operacionais e administrativos" },
        { label: "Lucro liquido", value: activeSummary.netProfit, note: "Receita menos CMV, insumos e despesas" },
        { label: "Retiradas", value: activeSummary.withdrawals, note: "Saidas pessoais e distribuicoes" },
        { label: "Resultado", value: activeSummary.result, note: "Lucro liquido menos retiradas" },
        { label: "Saldo disponivel", value: referenceResolved.summary.availableBalance, note: "Pix + Dinheiro - Cartao" },
        { label: "Estoque final", value: referenceResolved.summary.stockValue, note: "Valor do estoque no mes detalhado" },
      ],
      balances: referenceResolved.balances,
      lowStockItems,
      periodRevenueMix: [
        { label: "Receita", value: activeSummary.revenue },
        { label: "CMV", value: activeSummary.cmv },
        { label: "Insumos", value: activeSummary.inputs },
        { label: "Despesas", value: activeSummary.expenses },
        { label: "Retiradas", value: activeSummary.withdrawals },
      ],
      timeline: monthlyRows.map((row) => ({
        month: row.period.month,
        label: row.period.label.split(" ")[0],
        revenue: row.summary.revenue,
        result: row.summary.result,
        netProfit: row.summary.netProfit,
      })),
      annualTotals: {
        revenue: annualTotals.revenue,
        cmv: annualTotals.cmv,
        inputs: annualTotals.inputs,
        expenses: annualTotals.expenses,
        netProfit: annualTotals.netProfit,
        withdrawals: annualTotals.withdrawals,
        result: annualTotals.result,
      },
    };
  });
}

export async function getInventoryEntries(params?: SearchParams) {
  return withDatabase(async (db) => {
    const selected = await resolveSelectedPeriod(db, params);
    const queryParams: any[] = [selected.id];
    const filters = ["inventory_entries.period_id = ?"];
    const paymentMethodId = paramNumber(params, "paymentMethodId");
    const itemId = paramNumber(params, "itemId");
    const source = paramText(params, "source");
    const search = paramText(params, "q");

    if (paymentMethodId) {
      filters.push("inventory_entries.payment_method_id = ?");
      queryParams.push(paymentMethodId);
    }

    if (itemId) {
      filters.push("inventory_entries.item_id = ?");
      queryParams.push(itemId);
    }

    if (source) {
      filters.push("inventory_entries.source = ?");
      queryParams.push(source);
    }

    if (search) {
      filters.push("(items.name ILIKE ? OR inventory_entries.notes ILIKE ?)");
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    return await queryAll(
      db,
      `
        SELECT
          inventory_entries.id,
          inventory_entries.movement_date,
          inventory_entries.payment_method_id,
          payment_methods.name AS payment_method_name,
          inventory_entries.item_id,
          items.name AS item_name,
          inventory_entries.quantity,
          inventory_entries.total_amount,
          inventory_entries.notes,
          inventory_entries.source,
          purchases.id AS purchase_id,
          suppliers.name AS supplier_name,
          purchases.invoice_number
      FROM inventory_entries
      INNER JOIN items ON items.id = inventory_entries.item_id
      INNER JOIN payment_methods ON payment_methods.id = inventory_entries.payment_method_id
      LEFT JOIN purchase_items ON purchase_items.inventory_entry_id = inventory_entries.id
      LEFT JOIN purchases ON purchases.id = purchase_items.purchase_id
      LEFT JOIN suppliers ON suppliers.id = purchases.supplier_id
      WHERE ${filters.join(" AND ")}
      ORDER BY inventory_entries.movement_date DESC, inventory_entries.id DESC
    `,
      queryParams,
    ) as InventoryEntryRow[];
  });
}

export async function getInventoryUsages(params?: SearchParams) {
  return withDatabase(async (db) => {
    const selected = await resolveSelectedPeriod(db, params);
    const queryParams: any[] = [selected.id];
    const filters = ["inventory_usages.period_id = ?"];
    const itemId = paramNumber(params, "itemId");
    const source = paramText(params, "source");
    const search = paramText(params, "q");

    if (itemId) {
      filters.push("inventory_usages.item_id = ?");
      queryParams.push(itemId);
    }

    if (source) {
      filters.push("inventory_usages.source = ?");
      queryParams.push(source);
    }

    if (search) {
      filters.push("(items.name ILIKE ? OR inventory_usages.notes ILIKE ?)");
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    return await queryAll(
      db,
      `
        SELECT
          inventory_usages.id,
          inventory_usages.movement_date,
          inventory_usages.item_id,
          items.name AS item_name,
          inventory_usages.quantity,
          inventory_usages.notes,
          inventory_usages.source
      FROM inventory_usages
      INNER JOIN items ON items.id = inventory_usages.item_id
      WHERE ${filters.join(" AND ")}
      ORDER BY inventory_usages.movement_date DESC, inventory_usages.id DESC
    `,
      queryParams,
  ) as InventoryUsageRow[];
  });
}

export async function getFinancialTransactions(params?: SearchParams) {
  return withDatabase(async (db) => {
    const selected = await resolveSelectedPeriod(db, params);
    const queryParams: any[] = [selected.id];
    const filters = ["financial_transactions.period_id = ?"];
    const paymentMethodId = paramNumber(params, "paymentMethodId");
    const movementTypeId = paramNumber(params, "movementTypeId");
    const itemId = paramNumber(params, "itemId");
    const source = paramText(params, "source");
    const search = paramText(params, "q");

    if (paymentMethodId) {
      filters.push("financial_transactions.payment_method_id = ?");
      queryParams.push(paymentMethodId);
    }

    if (movementTypeId) {
      filters.push("financial_transactions.movement_type_id = ?");
      queryParams.push(movementTypeId);
    }

    if (itemId) {
      filters.push("financial_transactions.item_id = ?");
      queryParams.push(itemId);
    }

    if (source) {
      filters.push("financial_transactions.source = ?");
      queryParams.push(source);
    }

    if (search) {
      filters.push("(financial_transactions.description ILIKE ? OR financial_transactions.notes ILIKE ? OR items.name ILIKE ?)");
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    return await queryAll(
      db,
      `
        SELECT
          financial_transactions.id,
          financial_transactions.movement_date,
          financial_transactions.payment_method_id,
          payment_methods.name AS payment_method_name,
          financial_transactions.movement_type_id,
          movement_types.name AS movement_type_name,
          financial_transactions.description,
          financial_transactions.amount,
          financial_transactions.notes,
          financial_transactions.item_id,
          items.name AS item_name,
          financial_transactions.source,
          purchases.id AS purchase_id,
          suppliers.name AS supplier_name,
          purchases.invoice_number
        FROM financial_transactions
      INNER JOIN payment_methods ON payment_methods.id = financial_transactions.payment_method_id
      INNER JOIN movement_types ON movement_types.id = financial_transactions.movement_type_id
      LEFT JOIN items ON items.id = financial_transactions.item_id
      LEFT JOIN purchase_items ON purchase_items.financial_transaction_id = financial_transactions.id
      LEFT JOIN purchases ON purchases.id = purchase_items.purchase_id
      LEFT JOIN suppliers ON suppliers.id = purchases.supplier_id
      WHERE ${filters.join(" AND ")}
      ORDER BY financial_transactions.movement_date DESC, financial_transactions.id DESC
    `,
      queryParams,
  ) as FinancialTransactionRow[];
  });
}

export async function getTransfers(params?: SearchParams) {
  return withDatabase(async (db) => {
    const selected = await resolveSelectedPeriod(db, params);
    const queryParams: any[] = [selected.id];
    const filters = ["account_transfers.period_id = ?"];
    const paymentMethodId = paramNumber(params, "paymentMethodId");
    const source = paramText(params, "source");
    const search = paramText(params, "q");

    if (paymentMethodId) {
      filters.push("(account_transfers.from_payment_method_id = ? OR account_transfers.to_payment_method_id = ?)");
      queryParams.push(paymentMethodId, paymentMethodId);
    }

    if (source) {
      filters.push("account_transfers.source = ?");
      queryParams.push(source);
    }

    if (search) {
      filters.push("(account_transfers.description ILIKE ? OR account_transfers.notes ILIKE ?)");
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    return await queryAll(
      db,
      `
        SELECT
          account_transfers.id,
          account_transfers.movement_date,
          account_transfers.from_payment_method_id,
          from_methods.name AS from_payment_method_name,
          account_transfers.to_payment_method_id,
          to_methods.name AS to_payment_method_name,
          account_transfers.amount,
          account_transfers.description,
          account_transfers.notes,
          account_transfers.source
      FROM account_transfers
      INNER JOIN payment_methods AS from_methods ON from_methods.id = account_transfers.from_payment_method_id
      INNER JOIN payment_methods AS to_methods ON to_methods.id = account_transfers.to_payment_method_id
      WHERE ${filters.join(" AND ")}
      ORDER BY account_transfers.movement_date DESC, account_transfers.id DESC
    `,
      queryParams,
  ) as TransferRow[];
  });
}

export async function getEditBundle(params?: SearchParams): Promise<EditBundle> {
  return withDatabase(async (db) => {
    const bundle: EditBundle = {};

    if (params?.editItem) {
      bundle.item =
        (await queryOne(
          db,
          `
            SELECT
              items.id,
              items.name,
              items.category_id,
              item_categories.name AS category_name,
              items.unit_size,
              items.reference_price,
              items.price_per_kg,
              items.low_stock_threshold,
              items.notes,
              items.is_active
            FROM items
            LEFT JOIN item_categories ON item_categories.id = items.category_id
            WHERE items.id = ?
          `,
          [Number(params.editItem)],
        ) as ItemRecord) || null;
    }

    if (params?.editEntrada) {
      bundle.inventoryEntry =
        (await queryOne(
          db,
          `
            SELECT
              inventory_entries.id,
              inventory_entries.movement_date,
              inventory_entries.payment_method_id,
              payment_methods.name AS payment_method_name,
              inventory_entries.item_id,
              items.name AS item_name,
              inventory_entries.quantity,
              inventory_entries.total_amount,
              inventory_entries.notes,
              inventory_entries.source
            FROM inventory_entries
            INNER JOIN items ON items.id = inventory_entries.item_id
            INNER JOIN payment_methods ON payment_methods.id = inventory_entries.payment_method_id
            WHERE inventory_entries.id = ?
          `,
          [Number(params.editEntrada)],
        ) as InventoryEntryRow) || null;
    }

    if (params?.editSaida) {
      bundle.inventoryUsage =
        (await queryOne(
          db,
          `
            SELECT
              inventory_usages.id,
              inventory_usages.movement_date,
              inventory_usages.item_id,
              items.name AS item_name,
              inventory_usages.quantity,
              inventory_usages.notes,
              inventory_usages.source
            FROM inventory_usages
            INNER JOIN items ON items.id = inventory_usages.item_id
            WHERE inventory_usages.id = ?
          `,
          [Number(params.editSaida)],
        ) as InventoryUsageRow) || null;
    }

    if (params?.editLancamento) {
      bundle.financialTransaction =
        (await queryOne(
          db,
          `
            SELECT
              financial_transactions.id,
              financial_transactions.movement_date,
              financial_transactions.payment_method_id,
              payment_methods.name AS payment_method_name,
              financial_transactions.movement_type_id,
              movement_types.name AS movement_type_name,
              financial_transactions.description,
              financial_transactions.amount,
              financial_transactions.notes,
              financial_transactions.item_id,
              items.name AS item_name,
              financial_transactions.source
            FROM financial_transactions
            INNER JOIN payment_methods ON payment_methods.id = financial_transactions.payment_method_id
            INNER JOIN movement_types ON movement_types.id = financial_transactions.movement_type_id
            LEFT JOIN items ON items.id = financial_transactions.item_id
            WHERE financial_transactions.id = ?
          `,
          [Number(params.editLancamento)],
        ) as FinancialTransactionRow) || null;
    }

    if (params?.editTransferencia) {
      bundle.transfer =
        (await queryOne(
          db,
          `
            SELECT
              account_transfers.id,
              account_transfers.movement_date,
              account_transfers.from_payment_method_id,
              from_methods.name AS from_payment_method_name,
              account_transfers.to_payment_method_id,
              to_methods.name AS to_payment_method_name,
              account_transfers.amount,
              account_transfers.description,
              account_transfers.notes,
              account_transfers.source
            FROM account_transfers
            INNER JOIN payment_methods AS from_methods ON from_methods.id = account_transfers.from_payment_method_id
            INNER JOIN payment_methods AS to_methods ON to_methods.id = account_transfers.to_payment_method_id
            WHERE account_transfers.id = ?
          `,
          [Number(params.editTransferencia)],
        ) as TransferRow) || null;
    }

    return bundle;
  });
}

export async function getReportSnapshot(params?: SearchParams): Promise<ReportSnapshot> {
  return withDatabase(async (db) => {
    const selected = await resolveSelectedPeriod(db, params);
    const scope = parseScope(params);
    const resolved = await getResolvedPeriodData(db, selected.id);
    const yearPeriods = await getPeriodsForYear(db, selected.year);
    const referencePeriod =
      scope === "year" && yearPeriods.length ? yearPeriods[yearPeriods.length - 1] : selected;
    const referenceResolved = await getResolvedPeriodData(db, referencePeriod.id);
    const monthlyRows: { period: PeriodOption; summary: PeriodSummary }[] = [];
    for (const period of yearPeriods) {
      monthlyRows.push({ period, summary: (await getResolvedPeriodData(db, period.id)).summary });
    }
    const annualTotals = sumSummaries(monthlyRows.map((row) => row.summary));
    const selectedSummary = scope === "year" ? annualTotals : resolved.summary;

    return {
      period: selected,
      scope,
      summarySource: selectedSummary.source,
      hasOperationalDetail: referenceResolved.hasOperationalDetail,
      selectedSummary,
      annualSummary: {
        year: selected.year,
        totals: annualTotals,
      },
      monthlyRows,
      dre: buildDre(selectedSummary),
      balances: referenceResolved.balances,
      items: referenceResolved.itemMetrics,
    };
  });
}

export async function getExportRows(params?: SearchParams) {
  const report = await getReportSnapshot(params);

  return withDatabase(async (db) => {
    const scope = parseScope(params);
    const selected = await resolveSelectedPeriod(db, params);
    const periodFilterSql =
      scope === "year"
        ? "periods.year = ?"
        : "periods.year = ? AND periods.month = ?";
    const periodParams = scope === "year" ? [selected.year] : [selected.year, selected.month];

    const inventoryEntries = await queryAll(
      db,
      `
        SELECT
          periods.label AS period_label,
          inventory_entries.movement_date,
          payment_methods.name AS payment_method_name,
          items.name AS item_name,
          inventory_entries.quantity,
          inventory_entries.total_amount,
          inventory_entries.notes,
          inventory_entries.source,
          purchases.id AS purchase_id,
          suppliers.name AS supplier_name,
          purchases.invoice_number
        FROM inventory_entries
        INNER JOIN periods ON periods.id = inventory_entries.period_id
        INNER JOIN payment_methods ON payment_methods.id = inventory_entries.payment_method_id
        INNER JOIN items ON items.id = inventory_entries.item_id
        LEFT JOIN purchase_items ON purchase_items.inventory_entry_id = inventory_entries.id
        LEFT JOIN purchases ON purchases.id = purchase_items.purchase_id
        LEFT JOIN suppliers ON suppliers.id = purchases.supplier_id
        WHERE ${periodFilterSql}
        ORDER BY inventory_entries.movement_date ASC, inventory_entries.id ASC
      `,
      periodParams,
    );

    const inventoryUsages = await queryAll(
      db,
      `
        SELECT
          periods.label AS period_label,
          inventory_usages.movement_date,
          items.name AS item_name,
          inventory_usages.quantity,
          inventory_usages.notes,
          inventory_usages.source
        FROM inventory_usages
        INNER JOIN periods ON periods.id = inventory_usages.period_id
        INNER JOIN items ON items.id = inventory_usages.item_id
        WHERE ${periodFilterSql}
        ORDER BY inventory_usages.movement_date ASC, inventory_usages.id ASC
      `,
      periodParams,
    );

    const financialTransactions = await queryAll(
      db,
      `
        SELECT
          periods.label AS period_label,
          financial_transactions.movement_date,
          payment_methods.name AS payment_method_name,
          movement_types.name AS movement_type_name,
          financial_transactions.description,
          financial_transactions.amount,
          items.name AS item_name,
          financial_transactions.notes,
          financial_transactions.source,
          purchases.id AS purchase_id,
          suppliers.name AS supplier_name,
          purchases.invoice_number
        FROM financial_transactions
        INNER JOIN periods ON periods.id = financial_transactions.period_id
        INNER JOIN payment_methods ON payment_methods.id = financial_transactions.payment_method_id
        INNER JOIN movement_types ON movement_types.id = financial_transactions.movement_type_id
        LEFT JOIN items ON items.id = financial_transactions.item_id
        LEFT JOIN purchase_items ON purchase_items.financial_transaction_id = financial_transactions.id
        LEFT JOIN purchases ON purchases.id = purchase_items.purchase_id
        LEFT JOIN suppliers ON suppliers.id = purchases.supplier_id
        WHERE ${periodFilterSql}
        ORDER BY financial_transactions.movement_date ASC, financial_transactions.id ASC
      `,
      periodParams,
    );

    const purchaseRows = await queryAll(
      db,
      `
        SELECT periods.label AS period_label, purchases.id AS purchase_id,
          purchases.purchase_date, suppliers.name AS supplier_name,
          purchases.invoice_number, payment_methods.name AS payment_method_name,
          purchase_items.destination, purchase_items.description,
          purchase_items.quantity, purchase_items.total_amount,
          movement_types.name AS movement_type_name, purchases.notes
        FROM purchase_items
        INNER JOIN purchases ON purchases.id = purchase_items.purchase_id
        INNER JOIN periods ON periods.id = purchases.period_id
        INNER JOIN suppliers ON suppliers.id = purchases.supplier_id
        INNER JOIN payment_methods ON payment_methods.id = purchases.payment_method_id
        LEFT JOIN movement_types ON movement_types.id = purchase_items.movement_type_id
        WHERE ${periodFilterSql}
        ORDER BY purchases.purchase_date, purchases.id, purchase_items.id
      `,
      periodParams,
    );

    const transfers = await queryAll(
      db,
      `
        SELECT
          periods.label AS period_label,
          account_transfers.movement_date,
          from_methods.name AS from_name,
          to_methods.name AS to_name,
          account_transfers.amount,
          account_transfers.description,
          account_transfers.notes,
          account_transfers.source
        FROM account_transfers
        INNER JOIN periods ON periods.id = account_transfers.period_id
        INNER JOIN payment_methods AS from_methods ON from_methods.id = account_transfers.from_payment_method_id
        INNER JOIN payment_methods AS to_methods ON to_methods.id = account_transfers.to_payment_method_id
        WHERE ${periodFilterSql}
        ORDER BY account_transfers.movement_date ASC, account_transfers.id ASC
      `,
      periodParams,
    );

    const rows: string[][] = [];

    rows.push(["Resumo DRE"]);
    rows.push(["Linha", "Valor"]);
    report.dre.forEach((entry) => {
      rows.push([entry.label, entry.value.toFixed(2)]);
    });

    rows.push([]);
    rows.push(["Resumo por mes"]);
    rows.push(["Mes", "Receita", "CMV", "Insumos", "Despesas", "Lucro ou Prejuízo Líquido", "Retiradas", "Resultado Final"]);
    report.monthlyRows.forEach((row) => {
      rows.push([
        row.period.label,
        row.summary.revenue.toFixed(2),
        row.summary.cmv.toFixed(2),
        row.summary.inputs.toFixed(2),
        row.summary.expenses.toFixed(2),
        row.summary.netProfit.toFixed(2),
        row.summary.withdrawals.toFixed(2),
        row.summary.result.toFixed(2),
      ]);
    });

    rows.push([]);
    rows.push(["Compras integradas"]);
    rows.push([
      "Periodo",
      "Compra",
      "Data",
      "Fornecedor",
      "Nota",
      "Pagamento",
      "Destino",
      "Tipo financeiro",
      "Item ou descricao",
      "Quantidade",
      "Valor total",
      "Observacao",
    ]);
    purchaseRows.forEach((row) => {
      rows.push([
        String(row.period_label),
        String(row.purchase_id),
        String(row.purchase_date),
        String(row.supplier_name),
        String(row.invoice_number || ""),
        String(row.payment_method_name),
        row.destination === "inventory" ? "Estoque" : "Financeiro imediato",
        String(row.movement_type_name || ""),
        String(row.description),
        numeric(row.quantity).toFixed(2),
        numeric(row.total_amount).toFixed(2),
        String(row.notes || ""),
      ]);
    });

    rows.push([]);
    rows.push(["Entradas de estoque"]);
    rows.push(["Periodo", "Data", "Pagamento", "Item", "Quantidade", "Valor Total", "Compra", "Fornecedor", "Nota", "Observacao", "Origem"]);
    inventoryEntries.forEach((row) => {
      rows.push([
        String(row.period_label),
        String(row.movement_date),
        String(row.payment_method_name),
        String(row.item_name),
        numeric(row.quantity).toFixed(2),
        numeric(row.total_amount).toFixed(2),
        String(row.purchase_id || ""),
        String(row.supplier_name || ""),
        String(row.invoice_number || ""),
        String(row.notes || ""),
        String(row.source || ""),
      ]);
    });

    rows.push([]);
    rows.push(["Saidas de estoque"]);
    rows.push(["Periodo", "Data", "Item", "Quantidade", "Observacao", "Origem"]);
    inventoryUsages.forEach((row) => {
      rows.push([
        String(row.period_label),
        String(row.movement_date),
        String(row.item_name),
        numeric(row.quantity).toFixed(2),
        String(row.notes || ""),
        String(row.source || ""),
      ]);
    });

    rows.push([]);
    rows.push(["Lancamentos financeiros"]);
    rows.push(["Periodo", "Data", "Pagamento", "Tipo", "Descricao", "Item", "Valor", "Compra", "Fornecedor", "Nota", "Observacao", "Origem"]);
    financialTransactions.forEach((row) => {
      rows.push([
        String(row.period_label),
        String(row.movement_date),
        String(row.payment_method_name),
        String(row.movement_type_name),
        String(row.description),
        String(row.item_name || ""),
        numeric(row.amount).toFixed(2),
        String(row.purchase_id || ""),
        String(row.supplier_name || ""),
        String(row.invoice_number || ""),
        String(row.notes || ""),
        String(row.source || ""),
      ]);
    });

    rows.push([]);
    rows.push(["Transferencias"]);
    rows.push(["Periodo", "Data", "De", "Para", "Valor", "Descricao", "Observacao", "Origem"]);
    transfers.forEach((row) => {
      rows.push([
        String(row.period_label),
        String(row.movement_date),
        String(row.from_name),
        String(row.to_name),
        numeric(row.amount).toFixed(2),
        String(row.description),
        String(row.notes || ""),
        String(row.source || ""),
      ]);
    });

    return {
      filename:
        scope === "year"
          ? `lancamentos-anual-${selected.year}.csv`
          : `lancamentos-${selected.year}-${String(selected.month).padStart(2, "0")}.csv`,
      rows,
    };
  });
}

export async function createOrUpdateItem(input: {
  id?: number;
  name: string;
  categoryName: string;
  unitSize?: number | null;
  referencePrice?: number | null;
  pricePerKg?: number | null;
  lowStockThreshold?: number;
  notes?: string;
}) {
  return withTransaction(async (db) => {
    const categoryName = input.categoryName || "Outros";
    await run(db, "INSERT INTO item_categories (name) VALUES (?) ON CONFLICT (name) DO NOTHING", [categoryName]);
    const categoryId = await seedLookupId(db, "item_categories", categoryName);
    if (input.id) {
      await run(
        db,
        `
          UPDATE items
          SET name = ?, category_id = ?, unit_size = ?, reference_price = ?, price_per_kg = ?, low_stock_threshold = ?, notes = ?
          WHERE id = ?
        `,
        [
          input.name,
          categoryId,
          input.unitSize,
          input.referencePrice,
          input.pricePerKg,
          input.lowStockThreshold || 0,
          input.notes || null,
          input.id,
        ],
      );
    } else {
      await run(
        db,
        `
          INSERT INTO items (
            name, category_id, unit_size, reference_price, price_per_kg, low_stock_threshold, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          input.name,
          categoryId,
          input.unitSize,
          input.referencePrice,
          input.pricePerKg,
          input.lowStockThreshold || 0,
          input.notes || null,
        ],
      );
    }
  });
}

export async function deactivateItem(itemId: number) {
  return withTransaction(async (db) => {
    await run(db, "UPDATE items SET is_active = 0 WHERE id = ?", [itemId]);
  });
}

export async function reactivateItem(itemId: number) {
  return withTransaction(async (db) => {
    await run(db, "UPDATE items SET is_active = 1 WHERE id = ?", [itemId]);
  });
}

export async function createOrUpdateSupplier(input: {
  id?: number;
  name: string;
  contact?: string;
  notes?: string;
}) {
  return withTransaction(async (db) => {
    const name = input.name.trim();
    if (!name) {
      throw new Error("Informe o nome do fornecedor.");
    }
    const duplicate = await queryOne(
      db,
      "SELECT id FROM suppliers WHERE lower(name) = lower(?) AND id <> ?",
      [name, input.id || 0],
    );
    if (duplicate) {
      throw new Error("Já existe um fornecedor com esse nome.");
    }

    if (input.id) {
      await run(
        db,
        "UPDATE suppliers SET name = ?, contact = ?, notes = ? WHERE id = ?",
        [name, input.contact?.trim() || null, input.notes?.trim() || null, input.id],
      );
    } else {
      await run(
        db,
        "INSERT INTO suppliers (name, contact, notes) VALUES (?, ?, ?)",
        [name, input.contact?.trim() || null, input.notes?.trim() || null],
      );
    }
  });
}

export async function setSupplierActive(supplierId: number, active: boolean) {
  return withTransaction(async (db) => {
    assertPositive(supplierId, "O fornecedor");
    await run(db, "UPDATE suppliers SET is_active = ? WHERE id = ?", [active ? 1 : 0, supplierId]);
  });
}

function parseMovementDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error("Informe uma data válida no formato dia, mês e ano.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("Informe uma data válida.");
  }

  return { year, month };
}

function assertPositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} deve ser maior do que zero.`);
  }
}

function assertPeriodOpen(period: PeriodOption) {
  if (period.isClosed) {
    throw new Error(
      `${period.label} está fechado. Reabra o período no Financeiro antes de alterar lançamentos.`,
    );
  }
}

type PeriodRecordTable =
  | "inventory_entries"
  | "inventory_usages"
  | "financial_transactions"
  | "account_transfers";

async function assertRecordPeriodOpen(db: Db, table: PeriodRecordTable, recordId: number) {
  const record = await queryOne(
    db,
    `
      SELECT periods.id, periods.year, periods.month, periods.label,
        periods.is_closed, periods.closed_at
      FROM ${table}
      INNER JOIN periods ON periods.id = ${table}.period_id
      WHERE ${table}.id = ?
    `,
    [recordId],
  );
  if (!record) {
    throw new Error("O lançamento informado não foi encontrado.");
  }

  assertPeriodOpen({
    id: numeric(record.id),
    year: numeric(record.year),
    month: numeric(record.month),
    label: String(record.label),
    isClosed: numeric(record.is_closed) === 1,
    closedAt: record.closed_at == null ? null : String(record.closed_at),
  });
}

export async function periodFromDate(db: Db, date: string) {
  const { year, month } = parseMovementDate(date);
  const period = await ensurePeriod(db, year, month);
  assertPeriodOpen(period);
  return period;
}

export async function setPeriodClosed(input: {
  year: number;
  month: number;
  closed: boolean;
}) {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2200) {
    throw new Error("Ano inválido para o fechamento.");
  }
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    throw new Error("Mês inválido para o fechamento.");
  }

  return withTransaction(async (db) => {
    const period = await ensurePeriod(db, input.year, input.month);
    if (period.isClosed === input.closed) {
      return;
    }

    await run(
      db,
      input.closed
        ? "UPDATE periods SET is_closed = 1, closed_at = agora_texto() WHERE id = ?"
        : "UPDATE periods SET is_closed = 0, closed_at = NULL WHERE id = ?",
      [period.id],
    );
    await run(
      db,
      `
        INSERT INTO period_lock_history (period_id, action, note)
        VALUES (?, ?, ?)
      `,
      [
        period.id,
        input.closed ? "closed" : "reopened",
        input.closed
          ? "Período fechado pela tela Financeiro."
          : "Período reaberto pela tela Financeiro.",
      ],
    );
  });
}

type PurchaseLineInput = {
  destination: "inventory" | "financial";
  itemId?: number | null;
  description?: string;
  quantity: number;
  totalAmount: number;
  movementTypeId?: number | null;
};

async function assertPurchasePeriodOpen(db: Db, purchaseId: number) {
  const record = await queryOne(
    db,
    `
      SELECT periods.id, periods.year, periods.month, periods.label,
        periods.is_closed, periods.closed_at
      FROM purchases
      INNER JOIN periods ON periods.id = purchases.period_id
      WHERE purchases.id = ?
    `,
    [purchaseId],
  );
  if (!record) {
    throw new Error("A compra informada não foi encontrada.");
  }
  assertPeriodOpen({
    id: numeric(record.id),
    year: numeric(record.year),
    month: numeric(record.month),
    label: String(record.label),
    isClosed: numeric(record.is_closed) === 1,
    closedAt: record.closed_at == null ? null : String(record.closed_at),
  });
}

async function deletePurchaseChildren(db: Db, purchaseId: number) {
  const children = await queryAll(
    db,
    "SELECT inventory_entry_id, financial_transaction_id FROM purchase_items WHERE purchase_id = ?",
    [purchaseId],
  );
  await run(db, "DELETE FROM purchase_items WHERE purchase_id = ?", [purchaseId]);
  for (const child of children) {
    if (child.inventory_entry_id != null) {
      await run(db, "DELETE FROM inventory_entries WHERE id = ?", [numeric(child.inventory_entry_id)]);
    }
    if (child.financial_transaction_id != null) {
      await run(db, "DELETE FROM financial_transactions WHERE id = ?", [numeric(child.financial_transaction_id)]);
    }
  }
}

function purchaseReferenceNote(purchaseId: number, supplierName: string, invoiceNumber?: string) {
  return `Compra ${purchaseId} | Fornecedor: ${supplierName}${
    invoiceNumber ? ` | Nota: ${invoiceNumber}` : ""
  }`;
}

export async function createOrUpdatePurchase(input: {
  id?: number;
  date: string;
  supplierId: number;
  paymentMethodId: number;
  invoiceNumber?: string;
  notes?: string;
  lines: PurchaseLineInput[];
}) {
  return withTransaction(async (db) => {
    if (input.id) {
      await assertPurchasePeriodOpen(db, input.id);
    }
    assertPositive(input.supplierId, "O fornecedor");
    assertPositive(input.paymentMethodId, "A forma de pagamento");
    if (!input.lines.length) {
      throw new Error("Inclua pelo menos um item na compra.");
    }

    const supplier = await queryOne(db, "SELECT id, name FROM suppliers WHERE id = ?", [input.supplierId]);
    if (!supplier) {
      throw new Error("O fornecedor selecionado não foi encontrado.");
    }
    const paymentMethod = await queryOne(db, "SELECT id FROM payment_methods WHERE id = ?", [
      input.paymentMethodId,
    ]);
    if (!paymentMethod) {
      throw new Error("A forma de pagamento selecionada não foi encontrada.");
    }

    for (const [index, line] of input.lines.entries()) {
      assertPositive(line.quantity, `A quantidade do item ${index + 1}`);
      assertPositive(line.totalAmount, `O valor do item ${index + 1}`);
      if (line.destination === "inventory") {
        assertPositive(Number(line.itemId), `O produto de estoque do item ${index + 1}`);
        const item = await queryOne(db, "SELECT id FROM items WHERE id = ?", [line.itemId]);
        if (!item) throw new Error(`O produto de estoque do item ${index + 1} não foi encontrado.`);
      } else if (line.destination === "financial") {
        if (!line.description?.trim()) {
          throw new Error(`Informe a descrição do item ${index + 1}.`);
        }
        const movementType = await queryOne(
          db,
          "SELECT id FROM movement_types WHERE id = ? AND name IN ('Insumos', 'Despesa')",
          [line.movementTypeId],
        );
        if (!movementType) {
          throw new Error(`Selecione Insumos ou Despesa no item ${index + 1}.`);
        }
      } else {
        throw new Error(`O destino do item ${index + 1} é inválido.`);
      }
    }

    const period = await periodFromDate(db, input.date);
    let purchaseId = input.id || 0;
    if (purchaseId) {
      await deletePurchaseChildren(db, purchaseId);
      await run(
        db,
        `
          UPDATE purchases
          SET period_id = ?, purchase_date = ?, supplier_id = ?, payment_method_id = ?,
            invoice_number = ?, notes = ?
          WHERE id = ?
        `,
        [
          period.id,
          input.date,
          input.supplierId,
          input.paymentMethodId,
          input.invoiceNumber?.trim() || null,
          input.notes?.trim() || null,
          purchaseId,
        ],
      );
    } else {
      const inserted = await run(
        db,
        `
          INSERT INTO purchases (
            period_id, purchase_date, supplier_id, payment_method_id, invoice_number, notes
          ) VALUES (?, ?, ?, ?, ?, ?)
          RETURNING id
        `,
        [
          period.id,
          input.date,
          input.supplierId,
          input.paymentMethodId,
          input.invoiceNumber?.trim() || null,
          input.notes?.trim() || null,
        ],
      );
      purchaseId = numeric(inserted[0]?.id);
    }

    const referenceNote = purchaseReferenceNote(
      purchaseId,
      String(supplier.name),
      input.invoiceNumber?.trim(),
    );
    for (const line of input.lines) {
      if (line.destination === "inventory") {
        const item = await queryOne(db, "SELECT name FROM items WHERE id = ?", [line.itemId]);
        const entryRows = await run(
          db,
          `
            INSERT INTO inventory_entries (
              period_id, movement_date, payment_method_id, item_id, quantity,
              total_amount, notes, source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'purchase')
            RETURNING id
          `,
          [
            period.id,
            input.date,
            input.paymentMethodId,
            line.itemId,
            line.quantity,
            line.totalAmount,
            referenceNote,
          ],
        );
        const inventoryEntryId = numeric(entryRows[0]?.id);
        await run(
          db,
          `
            INSERT INTO purchase_items (
              purchase_id, destination, item_id, description, quantity, total_amount,
              inventory_entry_id
            ) VALUES (?, 'inventory', ?, ?, ?, ?, ?)
          `,
          [
            purchaseId,
            line.itemId,
            String(item.name),
            line.quantity,
            line.totalAmount,
            inventoryEntryId,
          ],
        );
      } else {
        const description = line.description?.trim() || "Item de consumo imediato";
        const transactionRows = await run(
          db,
          `
            INSERT INTO financial_transactions (
              period_id, movement_date, payment_method_id, movement_type_id,
              description, amount, notes, item_id, source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'purchase')
            RETURNING id
          `,
          [
            period.id,
            input.date,
            input.paymentMethodId,
            line.movementTypeId,
            description,
            line.totalAmount,
            `${referenceNote} | Quantidade informada: ${line.quantity}`,
          ],
        );
        const financialTransactionId = numeric(transactionRows[0]?.id);
        await run(
          db,
          `
            INSERT INTO purchase_items (
              purchase_id, destination, description, quantity, total_amount,
              movement_type_id, financial_transaction_id
            ) VALUES (?, 'financial', ?, ?, ?, ?, ?)
          `,
          [
            purchaseId,
            description,
            line.quantity,
            line.totalAmount,
            line.movementTypeId,
            financialTransactionId,
          ],
        );
      }
    }

    return purchaseId;
  });
}

export async function deletePurchase(purchaseId: number) {
  return withTransaction(async (db) => {
    await assertPurchasePeriodOpen(db, purchaseId);
    await deletePurchaseChildren(db, purchaseId);
    await run(db, "DELETE FROM purchases WHERE id = ?", [purchaseId]);
  });
}

async function assertNotPurchaseChild(
  db: Db,
  column: "inventory_entry_id" | "financial_transaction_id",
  recordId: number,
) {
  const link = await queryOne(
    db,
    `SELECT purchase_id FROM purchase_items WHERE ${column} = ?`,
    [recordId],
  );
  if (link) {
    throw new Error(
      `Este lançamento pertence à compra ${numeric(link.purchase_id)}. Faça a alteração pela aba Compras.`,
    );
  }
}

async function getAvailableItemQuantity(db: Db, periodId: number, itemId: number, usageIdToIgnore?: number) {
  const metrics = (await getItemMetricsInternal(db, periodId)).find((item) => item.id === itemId);
  if (!usageIdToIgnore) {
    return metrics?.finalQty ?? 0;
  }
  const usage = await queryOne(db, "SELECT quantity FROM inventory_usages WHERE id = ?", [usageIdToIgnore]);
  return (metrics?.finalQty ?? 0) + numeric(usage?.quantity);
}

export async function createOrUpdateInventoryEntry(input: {
  id?: number;
  date: string;
  paymentMethodId: number;
  itemId: number;
  quantity: number;
  totalAmount: number;
  notes?: string;
}) {
  return withTransaction(async (db) => {
    if (input.id) {
      await assertRecordPeriodOpen(db, "inventory_entries", input.id);
      await assertNotPurchaseChild(db, "inventory_entry_id", input.id);
    }
    assertPositive(input.paymentMethodId, "A forma de pagamento");
    assertPositive(input.itemId, "O item");
    assertPositive(input.quantity, "A quantidade");
    assertPositive(input.totalAmount, "O valor total");
    const period = await periodFromDate(db, input.date);
    if (input.id) {
      await run(
        db,
        `
          UPDATE inventory_entries
          SET period_id = ?, movement_date = ?, payment_method_id = ?, item_id = ?, quantity = ?, total_amount = ?, notes = ?, source = 'manual'
          WHERE id = ?
        `,
        [
          period.id,
          input.date,
          input.paymentMethodId,
          input.itemId,
          input.quantity,
          input.totalAmount,
          input.notes || null,
          input.id,
        ],
      );
    } else {
      await run(
        db,
        `
          INSERT INTO inventory_entries (
            period_id, movement_date, payment_method_id, item_id, quantity, total_amount, notes, source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')
        `,
        [
          period.id,
          input.date,
          input.paymentMethodId,
          input.itemId,
          input.quantity,
          input.totalAmount,
          input.notes || null,
        ],
      );
    }
  });
}

export async function deleteInventoryEntry(entryId: number) {
  return withTransaction(async (db) => {
    await assertRecordPeriodOpen(db, "inventory_entries", entryId);
    await assertNotPurchaseChild(db, "inventory_entry_id", entryId);
    await run(db, "DELETE FROM inventory_entries WHERE id = ?", [entryId]);
  });
}

export async function createOrUpdateInventoryUsage(input: {
  id?: number;
  date: string;
  itemId: number;
  quantity: number;
  notes?: string;
}) {
  return withTransaction(async (db) => {
    if (input.id) {
      await assertRecordPeriodOpen(db, "inventory_usages", input.id);
    }
    assertPositive(input.itemId, "O item");
    assertPositive(input.quantity, "A quantidade consumida");
    const period = await periodFromDate(db, input.date);
    const available = await getAvailableItemQuantity(db, period.id, input.itemId, input.id);
    if (input.quantity > available) {
      throw new Error("A saida nao pode ser maior do que o estoque disponivel para o item.");
    }

    if (input.id) {
      await run(
        db,
        `
          UPDATE inventory_usages
          SET period_id = ?, movement_date = ?, item_id = ?, quantity = ?, notes = ?, source = 'manual'
          WHERE id = ?
        `,
        [period.id, input.date, input.itemId, input.quantity, input.notes || null, input.id],
      );
    } else {
      await run(
        db,
        `
          INSERT INTO inventory_usages (
            period_id, movement_date, item_id, quantity, notes, source
          ) VALUES (?, ?, ?, ?, ?, 'manual')
        `,
        [period.id, input.date, input.itemId, input.quantity, input.notes || null],
      );
    }
  });
}

export async function deleteInventoryUsage(usageId: number) {
  return withTransaction(async (db) => {
    await assertRecordPeriodOpen(db, "inventory_usages", usageId);
    await run(db, "DELETE FROM inventory_usages WHERE id = ?", [usageId]);
  });
}

export async function createOrUpdateFinancialTransaction(input: {
  id?: number;
  date: string;
  paymentMethodId: number;
  movementTypeId: number;
  description: string;
  amount: number;
  itemId?: number | null;
  notes?: string;
}) {
  return withTransaction(async (db) => {
    if (input.id) {
      await assertRecordPeriodOpen(db, "financial_transactions", input.id);
      await assertNotPurchaseChild(db, "financial_transaction_id", input.id);
    }
    assertPositive(input.paymentMethodId, "A forma de pagamento");
    assertPositive(input.movementTypeId, "O tipo do lançamento");
    assertPositive(input.amount, "O valor");
    if (!input.description.trim()) {
      throw new Error("Informe a descrição do lançamento.");
    }
    const period = await periodFromDate(db, input.date);
    if (input.id) {
      await run(
        db,
        `
          UPDATE financial_transactions
          SET period_id = ?, movement_date = ?, payment_method_id = ?, movement_type_id = ?, description = ?, amount = ?, item_id = ?, notes = ?, source = 'manual'
          WHERE id = ?
        `,
        [
          period.id,
          input.date,
          input.paymentMethodId,
          input.movementTypeId,
          input.description,
          input.amount,
          input.itemId || null,
          input.notes || null,
          input.id,
        ],
      );
    } else {
      await run(
        db,
        `
          INSERT INTO financial_transactions (
            period_id, movement_date, payment_method_id, movement_type_id, description, amount, item_id, notes, source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')
        `,
        [
          period.id,
          input.date,
          input.paymentMethodId,
          input.movementTypeId,
          input.description,
          input.amount,
          input.itemId || null,
          input.notes || null,
        ],
      );
    }
  });
}

export async function deleteFinancialTransaction(transactionId: number) {
  return withTransaction(async (db) => {
    await assertRecordPeriodOpen(db, "financial_transactions", transactionId);
    await assertNotPurchaseChild(db, "financial_transaction_id", transactionId);
    await run(db, "DELETE FROM financial_transactions WHERE id = ?", [transactionId]);
  });
}

export async function createOrUpdateTransfer(input: {
  id?: number;
  date: string;
  fromPaymentMethodId: number;
  toPaymentMethodId: number;
  amount: number;
  description: string;
  notes?: string;
}) {
  return withTransaction(async (db) => {
    if (input.id) {
      await assertRecordPeriodOpen(db, "account_transfers", input.id);
    }
    assertPositive(input.fromPaymentMethodId, "A conta de origem");
    assertPositive(input.toPaymentMethodId, "A conta de destino");
    assertPositive(input.amount, "O valor");
    if (!input.description.trim()) {
      throw new Error("Informe a descrição da transferência.");
    }
    const period = await periodFromDate(db, input.date);
    if (input.fromPaymentMethodId === input.toPaymentMethodId) {
      throw new Error("A transferencia precisa usar contas diferentes.");
    }
    if (input.id) {
      await run(
        db,
        `
          UPDATE account_transfers
          SET period_id = ?, movement_date = ?, from_payment_method_id = ?, to_payment_method_id = ?, amount = ?, description = ?, notes = ?, source = 'manual'
          WHERE id = ?
        `,
        [
          period.id,
          input.date,
          input.fromPaymentMethodId,
          input.toPaymentMethodId,
          input.amount,
          input.description,
          input.notes || null,
          input.id,
        ],
      );
    } else {
      await run(
        db,
        `
          INSERT INTO account_transfers (
            period_id, movement_date, from_payment_method_id, to_payment_method_id, amount, description, notes, source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')
        `,
        [
          period.id,
          input.date,
          input.fromPaymentMethodId,
          input.toPaymentMethodId,
          input.amount,
          input.description,
          input.notes || null,
        ],
      );
    }
  });
}

export async function deleteTransfer(transferId: number) {
  return withTransaction(async (db) => {
    await assertRecordPeriodOpen(db, "account_transfers", transferId);
    await run(db, "DELETE FROM account_transfers WHERE id = ?", [transferId]);
  });
}
