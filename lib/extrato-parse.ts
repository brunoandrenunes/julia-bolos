// Leitura do extrato do banco, sem acesso ao banco de dados (testável à parte).
// PDF do Nubank (colunas: data | tipo | descrição | valor), CSV do Nubank e OFX.

export type StatementLine = {
  date: string; // AAAA-MM-DD
  amount: number; // positivo = entrada, negativo = saída
  kind: string; // ex.: "Transferência recebida pelo Pix"
  description: string; // texto completo da linha
  counterpart: string; // quem pagou / recebeu (antes do primeiro " - ")
};

export type ParsedStatement = {
  bank: string;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  totalIn: number | null; // como aparece no extrato
  totalOut: number | null;
  lines: StatementLine[];
  checks: { label: string; ok: boolean; detail: string }[];
};

export type PdfTextItem = { str: string; x: number; y: number };

const MONTHS: Record<string, string> = {
  JAN: "01", FEV: "02", MAR: "03", ABR: "04", MAI: "05", JUN: "06",
  JUL: "07", AGO: "08", SET: "09", OUT: "10", NOV: "11", DEZ: "12",
};
const LONG_MONTHS: Record<string, string> = {
  JANEIRO: "01", FEVEREIRO: "02", "MARÇO": "03", MARCO: "03", ABRIL: "04", MAIO: "05", JUNHO: "06",
  JULHO: "07", AGOSTO: "08", SETEMBRO: "09", OUTUBRO: "10", NOVEMBRO: "11", DEZEMBRO: "12",
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

// "1.026,21" / "+ 667,00" / "-48,00" → número
export function parseBrl(text: string): number | null {
  const clean = text.replace(/\s/g, "");
  const match = clean.match(/^([+-]?)(?:R\$)?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/);
  if (!match) return null;
  const value = Number(`${match[2].replace(/\./g, "")}.${match[3]}`);
  return match[1] === "-" ? -value : value;
}

export function counterpartOf(description: string) {
  const first = description.split(" - ")[0].trim();
  return first.replace(/\s+/g, " ").slice(0, 120);
}

function finish(statement: Omit<ParsedStatement, "checks">, dayTotals: Map<string, { in: number; out: number }>): ParsedStatement {
  const checks: ParsedStatement["checks"] = [];
  const sumIn = round2(statement.lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0));
  const sumOut = round2(statement.lines.filter((l) => l.amount < 0).reduce((s, l) => s - l.amount, 0));
  if (statement.totalIn !== null) {
    checks.push({ label: "Total de entradas", ok: Math.abs(sumIn - statement.totalIn) < 0.01, detail: `lido ${money(sumIn)} · extrato ${money(statement.totalIn)}` });
  }
  if (statement.totalOut !== null) {
    checks.push({ label: "Total de saídas", ok: Math.abs(sumOut - statement.totalOut) < 0.01, detail: `lido ${money(sumOut)} · extrato ${money(statement.totalOut)}` });
  }
  if (statement.openingBalance !== null && statement.closingBalance !== null) {
    const expected = round2(statement.openingBalance + sumIn - sumOut);
    checks.push({
      label: "Saldo final",
      ok: Math.abs(expected - statement.closingBalance) < 0.01,
      detail: `saldo inicial ${money(statement.openingBalance)} + entradas − saídas = ${money(expected)} · extrato ${money(statement.closingBalance)}`,
    });
  }
  if (dayTotals.size) {
    const wrong: string[] = [];
    dayTotals.forEach((total, date) => {
      const day = statement.lines.filter((l) => l.date === date);
      const dIn = round2(day.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0));
      const dOut = round2(day.filter((l) => l.amount < 0).reduce((s, l) => s - l.amount, 0));
      if (Math.abs(dIn - total.in) >= 0.01 || Math.abs(dOut - total.out) >= 0.01) wrong.push(date.split("-").reverse().join("/"));
    });
    checks.push({ label: "Totais de cada dia", ok: wrong.length === 0, detail: wrong.length ? `não conferem: ${wrong.join(", ")}` : `${dayTotals.size} dias conferidos` });
  }
  return { ...statement, checks };
}

/* ---------- PDF do Nubank ---------- */

// Colunas do PDF (em pontos, a partir da esquerda da página).
const COL_LABEL = 110;
const COL_DESC = 255;
const COL_AMOUNT = 450;
const STOP = /^(Tem alguma dúvida|Caso a solução|metropolitanas\)|disponíveis em nubank|Extrato gerado|O saldo líquido|Não nos responsabilizamos|Asseguramos|Nu Financeira|Nu Pagamentos|e Investimento|CNPJ: \d)/;

export function parseNubankPdf(pages: PdfTextItem[][]): ParsedStatement {
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;
  let totalIn: number | null = null;
  let totalOut: number | null = null;
  let inMovements = false;
  let currentDate = "";
  let sign = 1;
  let last: (StatementLine & { parts: string[] }) | null = null;
  const lines: (StatementLine & { parts: string[] })[] = [];
  const dayTotals = new Map<string, { in: number; out: number }>();

  for (const items of pages) {
    // Cabeçalho repetido em toda página (nome, CNPJ, período, "VALORES EM R$"): tudo dali para cima é ignorado,
    // exceto o período, lido uma vez.
    const headerY = Math.min(...items.filter((item) => /VALORES EM R\$/.test(item.str)).map((item) => item.y), Infinity);
    // Agrupa os pedaços de texto em linhas (mesma altura), de cima para baixo.
    const rows: PdfTextItem[][] = [];
    [...items]
      .filter((item) => item.str.trim())
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .forEach((item) => {
        const row = rows.find((r) => Math.abs(r[0].y - item.y) <= 3);
        if (row) row.push(item);
        else rows.push([item]);
      });

    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      const text = row.map((item) => item.str.trim()).join(" ");
      if (STOP.test(text)) break; // rodapé: o resto da página não é movimento

      const longDates = row.map((item) => item.str.trim().toUpperCase().match(/^(\d{2}) DE ([A-ZÇ]+) DE (\d{4})$/)).filter(Boolean) as RegExpMatchArray[];
      if (longDates.length >= 2) {
        if (!periodStart) {
          const toIso = (m: RegExpMatchArray) => `${m[3]}-${LONG_MONTHS[m[2]] || "01"}-${m[1]}`;
          periodStart = toIso(longDates[0]);
          periodEnd = toIso(longDates[1]);
        }
        continue;
      }
      if (Number.isFinite(headerY) ? row[0].y >= headerY - 1 : /VALORES EM R\$|^CNPJ|Agência \d+ Conta/.test(text)) continue;

      const dateCol = row.filter((item) => item.x < COL_LABEL).map((item) => item.str.trim()).join(" ");
      const labelCol = row.filter((item) => item.x >= COL_LABEL && item.x < COL_DESC).map((item) => item.str.trim()).join(" ");
      const descCol = row.filter((item) => item.x >= COL_DESC && item.x < COL_AMOUNT).map((item) => item.str.trim()).join(" ");
      const amountText = row.filter((item) => item.x >= COL_AMOUNT).map((item) => item.str.trim()).join(" ");
      const amount = parseBrl(amountText);

      if (!inMovements) {
        if (text === "Movimentações") {
          inMovements = true;
          continue;
        }
        // Resumo do topo da 1ª página.
        const label = row.filter((item) => item.x < COL_AMOUNT).map((item) => item.str.trim()).join(" ");
        if (amount !== null) {
          if (/^Saldo inicial/.test(label)) openingBalance = amount;
          else if (/^Total de entradas/.test(label)) totalIn = Math.abs(amount);
          else if (/^Total de saídas/.test(label)) totalOut = Math.abs(amount);
          else if (/^Saldo final do período/.test(label)) closingBalance = amount;
        }
        continue;
      }

      const dateMatch = dateCol.toUpperCase().match(/^(\d{2}) ([A-Z]{3}) (\d{4})$/);
      if (dateMatch) currentDate = `${dateMatch[3]}-${MONTHS[dateMatch[2]] || "01"}-${dateMatch[1]}`;

      if (/^Total de entradas/.test(labelCol)) {
        sign = 1;
        if (amount !== null && currentDate) dayTotals.set(currentDate, { in: Math.abs(amount), out: dayTotals.get(currentDate)?.out || 0 });
        last = null;
        continue;
      }
      if (/^Total de saídas/.test(labelCol)) {
        sign = -1;
        if (amount !== null && currentDate) dayTotals.set(currentDate, { in: dayTotals.get(currentDate)?.in || 0, out: Math.abs(amount) });
        last = null;
        continue;
      }
      if (/^Saldo do dia/.test(labelCol)) {
        last = null;
        continue;
      }
      if (labelCol && amount !== null && currentDate) {
        last = { date: currentDate, amount: sign * Math.abs(amount), kind: labelCol, description: "", counterpart: "", parts: descCol ? [descCol] : [] };
        lines.push(last);
        continue;
      }
      if (last && labelCol && amount === null && !descCol) {
        last.kind = `${last.kind} ${labelCol}`; // tipo que quebrou em duas linhas
        continue;
      }
      if (last && descCol && !labelCol) {
        last.parts.push(descCol); // descrição que continua na linha (ou página) seguinte
        if (amount !== null && !last.amount) last.amount = sign * Math.abs(amount);
      }
    }
  }

  return finish(
    {
      bank: "Nubank",
      periodStart,
      periodEnd,
      openingBalance,
      closingBalance,
      totalIn,
      totalOut,
      lines: lines.map(({ parts, ...line }) => {
        const description = parts.join(" ").replace(/\s+/g, " ").trim() || line.kind;
        return { ...line, description, counterpart: counterpartOf(description) };
      }),
    },
    dayTotals,
  );
}

/* ---------- CSV do Nubank (Data,Valor,Identificador,Descrição) ---------- */

function splitCsv(line: string) {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((cell) => cell.trim());
}

export function parseNubankCsv(text: string): ParsedStatement {
  const rows = text.replace(/^﻿/, "").split(/\r?\n/).filter((row) => row.trim());
  const header = splitCsv(rows[0] || "").map((cell) => cell.toLowerCase());
  const iDate = header.findIndex((cell) => cell.startsWith("data"));
  const iValue = header.findIndex((cell) => cell.startsWith("valor"));
  const iDesc = header.findIndex((cell) => cell.startsWith("descri"));
  if (iDate < 0 || iValue < 0) throw new Error("CSV sem as colunas Data e Valor.");
  const lines: StatementLine[] = rows.slice(1).map((row) => {
    const cells = splitCsv(row);
    const [d, m, y] = cells[iDate].split("/");
    const value = Number(cells[iValue].replace(",", "."));
    const description = (iDesc >= 0 ? cells[iDesc] : "").replace(/\s+/g, " ").trim();
    return { date: `${y}-${m}-${d}`, amount: value, kind: value >= 0 ? "Entrada" : "Saída", description, counterpart: counterpartOf(description.split(" - ").slice(1).join(" - ") || description) };
  }).filter((line) => /^\d{4}-\d{2}-\d{2}$/.test(line.date) && Number.isFinite(line.amount) && line.amount !== 0);
  const dates = lines.map((line) => line.date).sort();
  return finish({ bank: "Nubank (CSV)", periodStart: dates[0] || null, periodEnd: dates[dates.length - 1] || null, openingBalance: null, closingBalance: null, totalIn: null, totalOut: null, lines }, new Map());
}

/* ---------- OFX (padrão dos bancos) ---------- */

export function parseOfx(text: string): ParsedStatement {
  const tag = (block: string, name: string) => block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"))?.[1].trim() || "";
  const lines: StatementLine[] = [];
  for (const block of text.split(/<STMTTRN>/i).slice(1)) {
    const raw = tag(block, "DTPOSTED");
    const amount = Number(tag(block, "TRNAMT").replace(",", "."));
    const description = (tag(block, "MEMO") || tag(block, "NAME")).replace(/\s+/g, " ").trim();
    if (raw.length < 8 || !Number.isFinite(amount) || amount === 0) continue;
    lines.push({ date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`, amount, kind: amount > 0 ? "Entrada" : "Saída", description, counterpart: counterpartOf(description.split(" - ").slice(1).join(" - ") || description) });
  }
  const dates = lines.map((line) => line.date).sort();
  const closing = Number(tag(text, "BALAMT").replace(",", "."));
  return finish({ bank: "OFX", periodStart: dates[0] || null, periodEnd: dates[dates.length - 1] || null, openingBalance: null, closingBalance: Number.isFinite(closing) && tag(text, "BALAMT") ? closing : null, totalIn: null, totalOut: null, lines }, new Map());
}

// Impressão digital de cada linha: a mesma linha em dois extratos que se sobrepõem gera o mesmo código.
export function fingerprints(lines: StatementLine[]) {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const base = `${line.date}|${line.amount.toFixed(2)}|${line.description.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return `${base}|${n}`;
  });
}
