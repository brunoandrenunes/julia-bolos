// Copia todos os dados do banco SQLite do sistema antigo para o Supabase,
// preservando os números (ids) de cada registro, e confere o resultado.
//
// Uso:  node scripts/importar-sqlite.mjs <arquivo.sqlite> [--substituir]
//
// Sem --substituir, só grava se o Supabase estiver vazio.
// Com --substituir, apaga os dados do Supabase e carrega de novo (usado na virada,
// para trazer os lançamentos feitos no sistema antigo até o último momento).
// Tudo acontece numa única transação: se qualquer conferência falhar, nada é gravado.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const postgresModule = require("postgres");
const postgres = postgresModule.default || postgresModule;
const initSqlJs = require("sql.js");

const TABLES = [
  "meta",
  "periods",
  "period_lock_history",
  "period_snapshots",
  "item_categories",
  "payment_methods",
  "movement_types",
  "items",
  "inventory_opening_balances",
  "inventory_entries",
  "inventory_usages",
  "financial_transactions",
  "account_transfers",
  "suppliers",
  "purchases",
  "purchase_items",
];

// Colunas numéricas somadas na conferência (além da contagem de linhas).
const CHECKSUM_COLUMNS = {
  periods: ["opening_bank_balance", "opening_cash_balance", "opening_card_balance", "is_closed"],
  period_snapshots: ["revenue", "cmv", "inputs", "expenses", "net_profit", "withdrawals", "result"],
  items: ["low_stock_threshold", "is_active"],
  inventory_opening_balances: ["quantity", "total_value"],
  inventory_entries: ["quantity", "total_amount", "item_id", "period_id"],
  inventory_usages: ["quantity", "item_id", "period_id"],
  financial_transactions: ["amount", "movement_type_id", "payment_method_id", "period_id"],
  account_transfers: ["amount", "from_payment_method_id", "to_payment_method_id"],
  purchases: ["supplier_id", "payment_method_id", "period_id"],
  purchase_items: ["quantity", "total_amount", "inventory_entry_id", "financial_transaction_id"],
};

function readEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0 && !line.startsWith("#")) env[line.slice(0, index)] = line.slice(index + 1);
  }
  return env;
}

const sqlitePath = process.argv[2];
const replace = process.argv.includes("--substituir");
if (!sqlitePath || !fs.existsSync(sqlitePath)) {
  console.error("Informe o caminho do arquivo .sqlite do sistema antigo.");
  process.exit(1);
}

const SQL = await initSqlJs();
const source = new SQL.Database(fs.readFileSync(sqlitePath));
const integrity = source.exec("PRAGMA integrity_check")[0].values[0][0];
if (integrity !== "ok") {
  console.error("O banco de origem não passou na verificação de integridade:", integrity);
  process.exit(1);
}

function sourceRows(table) {
  const result = source.exec(`SELECT * FROM ${table} ORDER BY rowid`);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((row) => Object.fromEntries(columns.map((column, i) => [column, row[i]])));
}

function summarize(table, rows) {
  const sums = Object.fromEntries(
    (CHECKSUM_COLUMNS[table] || []).map((column) => [
      column,
      Math.round(rows.reduce((sum, row) => sum + Number(row[column] || 0), 0) * 100) / 100,
    ]),
  );
  return { rows: rows.length, maxId: rows.reduce((max, row) => Math.max(max, Number(row.id || 0)), 0), ...sums };
}

const sql = postgres(readEnv().DATABASE_URL, { prepare: false, max: 1 });
const report = [];

try {
  await sql.begin(async (tx) => {
    const existing = await tx`SELECT count(*)::int AS n FROM periods`;
    if (existing[0].n > 0 && !replace) {
      throw new Error("O Supabase já tem dados. Use --substituir para apagar e carregar de novo.");
    }
    if (replace) {
      for (const table of [...TABLES].reverse()) {
        await tx.unsafe(`DELETE FROM ${table}`);
      }
    }

    for (const table of TABLES) {
      const rows = sourceRows(table);
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        await tx`INSERT INTO ${tx(table)} ${tx(chunk, Object.keys(chunk[0]))}`;
      }
      if (table !== "meta") {
        await tx.unsafe(
          `SELECT setval(pg_get_serial_sequence('app.${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`,
        );
      }

      const loaded = (await tx.unsafe(`SELECT * FROM ${table}`)).map((row) => ({ ...row }));
      const before = summarize(table, rows);
      const after = summarize(table, loaded);
      const ok = JSON.stringify(before) === JSON.stringify(after);
      report.push({ table, ...before, ok });
      if (!ok) {
        throw new Error(`Conferência falhou em ${table}: ${JSON.stringify(before)} x ${JSON.stringify(after)}`);
      }
    }
  });
  console.table(report);
  console.log(`Carga concluída a partir de ${sqlitePath}.`);
} catch (error) {
  console.table(report);
  console.error("NADA FOI GRAVADO.", error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
