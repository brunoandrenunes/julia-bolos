import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { dbHelpers, withDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Todas as tabelas do sistema, na ordem em que precisam ser recarregadas numa restauração.
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

// Backup completo em Excel: uma aba por tabela, com todas as colunas e os números (ids)
// de cada registro, para guardar no OneDrive e permitir restaurar o banco se preciso.
export async function GET() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sistema Julia Ronsoni Bolos";
  workbook.created = new Date();
  const info = workbook.addWorksheet("leia-me");

  const counts = await withDatabase(async (db) => {
    const result: [string, number][] = [];
    for (const table of TABLES) {
      const rows = await dbHelpers.queryAll(
        db,
        table === "meta" ? "SELECT * FROM meta ORDER BY key" : `SELECT * FROM ${table} ORDER BY id`,
      );
      const sheet = workbook.addWorksheet(table);
      const columns = rows.length
        ? Object.keys(rows[0])
        : (
            await dbHelpers.queryAll(
              db,
              "SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = ? ORDER BY ordinal_position",
              [table],
            )
          ).map((row) => String(row.column_name));
      sheet.columns = columns.map((column) => ({ header: column, key: column, width: 18 }));
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      rows.forEach((row) => sheet.addRow(row));
      result.push([table, rows.length]);
    }
    return result;
  });

  const now = new Date();
  const stamp = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(now)
    .replace(" ", "-")
    .replace(":", "");

  info.addRow(["Backup completo do sistema Julia Ronsoni Bolos"]).font = { bold: true };
  info.addRow(["Gerado em", stamp]);
  info.addRow([]);
  info.addRow(["Tabela", "Registros"]).font = { bold: true };
  counts.forEach(([table, count]) => info.addRow([table, count]));
  info.getColumn(1).width = 30;
  info.getColumn(2).width = 20;

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="backup-julia-bolos-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
