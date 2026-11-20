import { dbHelpers, withDatabase, withTransaction, type Db } from "@/lib/db";
import { deleteFinancialTransaction, deleteTransfer, matchImmediateItem, periodFromDate } from "@/lib/data";
import { readStatementFile } from "@/lib/extrato-arquivo";
import { fingerprints, type ParsedStatement } from "@/lib/extrato-parse";
import { normalizeText } from "@/lib/utils";

/* ===================================================================
   Extrato bancário: importar, conferir e classificar
   1) O arquivo é lido e cada linha nova é guardada (linhas repetidas de
      extratos que se sobrepõem são descartadas pela "impressão digital").
   2) Na revisão, o sistema procura o que já foi lançado (mesmo valor e
      data próxima, ou a soma do dia) e sugere o tipo pelo histórico.
   3) Cada linha vira lançamento novo, é vinculada ao que já existia,
      ou é ignorada. Desfazer devolve a linha para a revisão.
   =================================================================== */

const { queryAll, queryOne, run } = dbHelpers;
const num = (value: unknown) => Number(value || 0);
const DAY = 86_400_000;
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;
const shift = (date: string, days: number) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
const same = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) < 0.005;

// Conta do banco (Nubank) = forma de pagamento "Pix".
async function bankAccount(db: Db) {
  const row = await queryOne(db, "SELECT id, name FROM payment_methods WHERE name = 'Pix'");
  if (!row) throw new Error("Conta Pix (Nubank) não encontrada.");
  return { id: num(row.id), name: String(row.name) };
}

export async function importStatement(input: { bytes: Uint8Array; fileName: string }) {
  const parsed = await readStatementFile(input.bytes, input.fileName);
  const failed = parsed.checks.filter((check) => !check.ok);
  if (failed.length) {
    throw new Error(`A leitura do extrato não confere (${failed.map((check) => `${check.label}: ${check.detail}`).join("; ")}). Nada foi importado.`);
  }
  return withTransaction(async (db) => {
    const account = await bankAccount(db);
    const batch = await run(
      db,
      `INSERT INTO bank_imports (payment_method_id, file_name, period_start, period_end, opening_balance, closing_balance, total_in, total_out, lines_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [account.id, input.fileName.slice(0, 200), parsed.periodStart, parsed.periodEnd, parsed.openingBalance, parsed.closingBalance, parsed.totalIn, parsed.totalOut, parsed.lines.length],
    );
    const importId = num(batch[0]?.id);
    const prints = fingerprints(parsed.lines);
    let created = 0;
    for (const [index, line] of parsed.lines.entries()) {
      const inserted = await run(
        db,
        `INSERT INTO bank_statement_lines (import_id, payment_method_id, movement_date, amount, kind, description, counterpart, fingerprint)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (payment_method_id, fingerprint) DO NOTHING RETURNING id`,
        [importId, account.id, line.date, line.amount, line.kind, line.description, line.counterpart, prints[index]],
      );
      created += inserted.length;
    }
    await run(db, "UPDATE bank_imports SET lines_new = ? WHERE id = ?", [created, importId]);
    return { parsed, created, repeated: parsed.lines.length - created };
  });
}

export type MatchSuggestion = { kind: "ft" | "purchase" | "transfer"; id: number; label: string; group: boolean };

export type ReviewLine = {
  id: number;
  date: string;
  amount: number;
  kind: string;
  description: string;
  counterpart: string;
  match: MatchSuggestion | null;
  suggestedTypeId: number | null;
  suggestedDescription: string;
  learned: boolean;
};

export type ResolvedLine = {
  id: number;
  date: string;
  amount: number;
  counterpart: string;
  status: "lançado" | "vinculado" | "ignorado";
  target: string;
};

export async function getStatementReview() {
  return withDatabase(async (db) => {
    const account = await bankAccount(db);
    const [pending, resolved, lastImport, types, accounts] = await Promise.all([
      queryAll(
        db,
        `SELECT * FROM bank_statement_lines
         WHERE payment_method_id = ? AND ignored = 0 AND financial_transaction_id IS NULL AND purchase_id IS NULL AND transfer_id IS NULL
         ORDER BY movement_date, id`,
        [account.id],
      ),
      queryAll(
        db,
        `SELECT l.*, f.description AS ft_description, t.name AS ft_type, s.name AS supplier_name, tr.description AS transfer_description
         FROM bank_statement_lines l
         LEFT JOIN financial_transactions f ON f.id = l.financial_transaction_id
         LEFT JOIN movement_types t ON t.id = f.movement_type_id
         LEFT JOIN purchases p ON p.id = l.purchase_id
         LEFT JOIN suppliers s ON s.id = p.supplier_id
         LEFT JOIN account_transfers tr ON tr.id = l.transfer_id
         WHERE l.payment_method_id = ? AND (l.ignored = 1 OR l.financial_transaction_id IS NOT NULL OR l.purchase_id IS NOT NULL OR l.transfer_id IS NOT NULL)
         ORDER BY coalesce(l.resolved_at, l.created_at) DESC, l.movement_date DESC, l.id DESC LIMIT 80`,
        [account.id],
      ),
      queryOne(db, "SELECT * FROM bank_imports WHERE payment_method_id = ? ORDER BY id DESC LIMIT 1", [account.id]),
      queryAll(db, "SELECT id, name, group_name FROM movement_types ORDER BY id"),
      queryAll(db, "SELECT id, name FROM payment_methods WHERE id <> ? ORDER BY id", [account.id]),
    ]);

    const lines: ReviewLine[] = pending.map((row) => ({
      id: num(row.id),
      date: String(row.movement_date),
      amount: num(row.amount),
      kind: String(row.kind || ""),
      description: String(row.description),
      counterpart: String(row.counterpart || ""),
      match: null,
      suggestedTypeId: null,
      suggestedDescription: "",
      learned: false,
    }));

    if (lines.length) {
      const from = shift(lines[0].date, -5);
      const to = shift(lines[lines.length - 1].date, 5);
      const [fts, purchases, transfers, learnedRows] = await Promise.all([
        queryAll(
          db,
          `SELECT f.id, f.movement_date, f.amount, f.description, t.name AS type_name, t.group_name
           FROM financial_transactions f JOIN movement_types t ON t.id = f.movement_type_id
           WHERE f.payment_method_id = ? AND f.movement_date BETWEEN ? AND ?
             AND NOT EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.financial_transaction_id = f.id)
             AND NOT EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.financial_transaction_id = f.id)
           ORDER BY f.movement_date, f.id`,
          [account.id, from, to],
        ),
        queryAll(
          db,
          `SELECT p.id, p.purchase_date, s.name AS supplier, SUM(pi.total_amount) AS total
           FROM purchases p JOIN suppliers s ON s.id = p.supplier_id JOIN purchase_items pi ON pi.purchase_id = p.id
           WHERE p.payment_method_id = ? AND p.purchase_date BETWEEN ? AND ?
             AND NOT EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.purchase_id = p.id)
           GROUP BY p.id, p.purchase_date, s.name ORDER BY p.purchase_date`,
          [account.id, from, to],
        ),
        queryAll(
          db,
          `SELECT tr.id, tr.movement_date, tr.amount, tr.description, tr.from_payment_method_id, tr.to_payment_method_id
           FROM account_transfers tr
           WHERE (tr.from_payment_method_id = ? OR tr.to_payment_method_id = ?) AND tr.movement_date BETWEEN ? AND ?
             AND NOT EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.transfer_id = tr.id)`,
          [account.id, account.id, from, to],
        ),
        // O que foi feito antes com o mesmo pagador/recebedor (mais recente primeiro).
        queryAll(
          db,
          `SELECT l.counterpart, l.amount, f.movement_type_id, f.description
           FROM bank_statement_lines l JOIN financial_transactions f ON f.id = l.financial_transaction_id
           WHERE l.payment_method_id = ? ORDER BY l.resolved_at DESC NULLS LAST, l.id DESC`,
          [account.id],
        ),
      ]);

      type Candidate = { kind: MatchSuggestion["kind"]; id: number; date: string; amount: number; sign: number; label: string; used: boolean };
      const candidates: Candidate[] = [
        ...fts.map((row) => ({
          kind: "ft" as const,
          id: num(row.id),
          date: String(row.movement_date),
          amount: num(row.amount),
          sign: row.group_name === "income" ? 1 : row.group_name === "expense" ? -1 : 0,
          label: `${row.type_name} · ${row.description} · ${String(row.movement_date).split("-").reverse().join("/")}`,
          used: false,
        })),
        ...purchases.map((row) => ({
          kind: "purchase" as const,
          id: num(row.id),
          date: String(row.purchase_date),
          amount: num(row.total),
          sign: -1,
          label: `Compra · ${row.supplier} · ${String(row.purchase_date).split("-").reverse().join("/")}`,
          used: false,
        })),
        ...transfers.map((row) => ({
          kind: "transfer" as const,
          id: num(row.id),
          date: String(row.movement_date),
          amount: num(row.amount),
          sign: num(row.from_payment_method_id) === account.id ? -1 : 1,
          label: `Transferência · ${row.description} · ${String(row.movement_date).split("-").reverse().join("/")}`,
          used: false,
        })),
      ];
      const signOf = (amount: number) => (amount > 0 ? 1 : -1);
      const fits = (c: Candidate, sign: number) => !c.used && (c.sign === 0 || c.sign === sign);

      // 1) Mesmo valor, data até 3 dias de diferença (a mais próxima ganha).
      for (const line of lines) {
        const best = candidates
          .filter((c) => fits(c, signOf(line.amount)) && same(c.amount, line.amount) && dayDiff(c.date, line.date) <= 3)
          .sort((a, b) => dayDiff(a.date, line.date) - dayDiff(b.date, line.date))[0];
        if (best) {
          best.used = true;
          line.match = { kind: best.kind, id: best.id, label: best.label, group: false };
        }
      }
      // 2) Soma do dia: vários Pix lançados juntos num único lançamento (ex.: "Recebimentos" do dia).
      const groups = new Map<string, ReviewLine[]>();
      lines.filter((line) => !line.match).forEach((line) => {
        const key = `${line.date}|${signOf(line.amount)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(line);
      });
      groups.forEach((group) => {
        if (group.length < 2) return;
        const total = group.reduce((sum, line) => sum + line.amount, 0);
        const best = candidates
          .filter((c) => c.kind === "ft" && fits(c, signOf(total)) && same(c.amount, total) && dayDiff(c.date, group[0].date) <= 1)
          .sort((a, b) => dayDiff(a.date, group[0].date) - dayDiff(b.date, group[0].date))[0];
        if (!best) return;
        best.used = true;
        group.forEach((line) => {
          line.match = { kind: "ft", id: best.id, label: `${best.label} (soma de ${group.length} Pix do dia)`, group: true };
        });
      });

      // Sugestão de classificação: o que foi feito da última vez com o mesmo pagador/recebedor.
      const learned = new Map<string, { typeId: number; description: string }>();
      learnedRows.forEach((row) => {
        const key = `${normalizeText(String(row.counterpart || ""))}|${num(row.amount) > 0 ? 1 : -1}`;
        if (!learned.has(key)) learned.set(key, { typeId: num(row.movement_type_id), description: String(row.description) });
      });
      const revenue = types.find((row) => row.name === "Receita");
      lines.forEach((line) => {
        const hit = learned.get(`${normalizeText(line.counterpart)}|${signOf(line.amount)}`);
        if (hit) {
          line.suggestedTypeId = hit.typeId;
          line.suggestedDescription = hit.description;
          line.learned = true;
        } else if (line.amount > 0) {
          line.suggestedTypeId = revenue ? num(revenue.id) : null;
          line.suggestedDescription = "Recebimentos";
        } else {
          line.suggestedDescription = line.counterpart;
        }
      });
    }

    const resolvedLines: ResolvedLine[] = resolved.map((row) => ({
      id: num(row.id),
      date: String(row.movement_date),
      amount: num(row.amount),
      counterpart: String(row.counterpart || row.description),
      status: num(row.ignored) === 1 ? "ignorado" : num(row.created_record) === 1 ? "lançado" : "vinculado",
      target: num(row.ignored) === 1
        ? "—"
        : row.financial_transaction_id != null
          ? `${row.ft_type} · ${row.ft_description}`
          : row.purchase_id != null
            ? `Compra · ${row.supplier_name}`
            : `Transferência · ${row.transfer_description}`,
    }));

    return {
      account,
      lines,
      resolved: resolvedLines,
      lastImport: lastImport
        ? {
            periodStart: lastImport.period_start ? String(lastImport.period_start) : null,
            periodEnd: lastImport.period_end ? String(lastImport.period_end) : null,
            closingBalance: lastImport.closing_balance == null ? null : num(lastImport.closing_balance),
            createdAt: String(lastImport.created_at),
            linesNew: num(lastImport.lines_new),
            linesTotal: num(lastImport.lines_total),
          }
        : null,
      types: types.map((row) => ({ id: num(row.id), name: String(row.name), group: String(row.group_name) })),
      accounts: accounts.map((row) => ({ id: num(row.id), name: String(row.name) })),
    };
  });
}

export type StatementAction = {
  lineId: number;
  action: "lancar" | "transferir" | "vincular" | "ignorar";
  typeId?: number | null;
  description?: string;
  accountId?: number | null; // outra conta, para transferência
  match?: { kind: MatchSuggestion["kind"]; id: number } | null;
};

export async function applyStatementActions(actions: StatementAction[]) {
  if (!actions.length) throw new Error("Marque pelo menos uma linha.");
  return withTransaction(async (db) => {
    const account = await bankAccount(db);
    const counts = { lancar: 0, transferir: 0, vincular: 0, ignorar: 0 };
    for (const action of actions) {
      const line = await queryOne(
        db,
        `SELECT * FROM bank_statement_lines WHERE id = ? AND payment_method_id = ?
           AND ignored = 0 AND financial_transaction_id IS NULL AND purchase_id IS NULL AND transfer_id IS NULL`,
        [action.lineId, account.id],
      );
      if (!line) continue; // já resolvida (ex.: duas abas abertas)
      const date = String(line.movement_date);
      const amount = num(line.amount);
      const label = `${date.split("-").reverse().join("/")} ${String(line.counterpart || "")}`;

      if (action.action === "ignorar") {
        await run(db, "UPDATE bank_statement_lines SET ignored = 1, resolved_at = agora_texto() WHERE id = ?", [action.lineId]);
      } else if (action.action === "vincular") {
        const target = action.match;
        if (!target) throw new Error(`${label}: escolha o lançamento a vincular.`);
        const table = target.kind === "ft" ? "financial_transactions" : target.kind === "purchase" ? "purchases" : "account_transfers";
        const column = target.kind === "ft" ? "financial_transaction_id" : target.kind === "purchase" ? "purchase_id" : "transfer_id";
        if (!(await queryOne(db, `SELECT id FROM ${table} WHERE id = ?`, [target.id]))) {
          throw new Error(`${label}: o lançamento a vincular não existe mais.`);
        }
        await run(db, `UPDATE bank_statement_lines SET ${column} = ?, resolved_at = agora_texto() WHERE id = ?`, [target.id, action.lineId]);
      } else if (action.action === "transferir") {
        if (!action.accountId || action.accountId === account.id) throw new Error(`${label}: escolha a outra conta da transferência.`);
        const period = await periodFromDate(db, date);
        const inserted = await run(
          db,
          `INSERT INTO account_transfers (period_id, movement_date, from_payment_method_id, to_payment_method_id, amount, description, notes, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'extrato') RETURNING id`,
          [
            period.id,
            date,
            amount < 0 ? account.id : action.accountId,
            amount < 0 ? action.accountId : account.id,
            Math.abs(amount),
            action.description?.trim() || "Transferência entre contas",
            `Extrato: ${line.kind} · ${line.counterpart}`,
          ],
        );
        await run(db, "UPDATE bank_statement_lines SET transfer_id = ?, created_record = 1, resolved_at = agora_texto() WHERE id = ?", [num(inserted[0]?.id), action.lineId]);
      } else {
        const type = await queryOne(db, "SELECT id, name, group_name FROM movement_types WHERE id = ?", [action.typeId || 0]);
        if (!type) throw new Error(`${label}: escolha o tipo do lançamento.`);
        if ((type.group_name === "income" && amount < 0) || (type.group_name === "expense" && amount > 0)) {
          throw new Error(`${label}: "${type.name}" não combina com ${amount > 0 ? "uma entrada" : "uma saída"}.`);
        }
        const typed = action.description?.trim() || String(line.counterpart || "Extrato");
        const period = await periodFromDate(db, date);
        const standard = await matchImmediateItem(db, typed, num(type.id), false);
        const inserted = await run(
          db,
          `INSERT INTO financial_transactions (period_id, movement_date, payment_method_id, movement_type_id, description, amount, notes, source, immediate_item_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'extrato', ?) RETURNING id`,
          [period.id, date, account.id, num(type.id), standard?.name || typed, Math.abs(amount), `Extrato: ${line.kind} · ${line.counterpart}`, standard?.id ?? null],
        );
        await run(db, "UPDATE bank_statement_lines SET financial_transaction_id = ?, created_record = 1, resolved_at = agora_texto() WHERE id = ?", [num(inserted[0]?.id), action.lineId]);
      }
      counts[action.action] += 1;
    }
    return counts;
  });
}

// Devolve a linha para a revisão. Se o lançamento foi criado pela importação, ele é excluído.
export async function reopenStatementLine(lineId: number) {
  const line = await withDatabase((db) => queryOne(db, "SELECT * FROM bank_statement_lines WHERE id = ?", [lineId]));
  if (!line) throw new Error("Linha do extrato não encontrada.");
  if (num(line.created_record) === 1) {
    if (line.financial_transaction_id != null) await deleteFinancialTransaction(num(line.financial_transaction_id));
    if (line.transfer_id != null) await deleteTransfer(num(line.transfer_id));
  }
  await withTransaction((db) =>
    run(
      db,
      `UPDATE bank_statement_lines SET ignored = 0, created_record = 0, financial_transaction_id = NULL, purchase_id = NULL,
         transfer_id = NULL, resolved_at = NULL WHERE id = ?`,
      [lineId],
    ),
  );
}

export type { ParsedStatement };
