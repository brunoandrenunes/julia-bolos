"use client";

import { useMemo, useState } from "react";
import { registerCountAction } from "@/app/actions";
import type { CountRow } from "@/lib/analise";

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function qty(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}

function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Folha de contagem: digita o que sobrou; a baixa (consumo) é calculada na hora.
export function CountSheet({
  rows,
  date,
  year,
  month,
  disabled,
}: {
  rows: CountRow[];
  date: string;
  year: number;
  month: number;
  disabled: boolean;
}) {
  const [counted, setCounted] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("");
  const categories = useMemo(() => Array.from(new Set(rows.map((row) => row.categoryName))), [rows]);

  const filled = rows.filter((row) => (counted[row.id] ?? "") !== "");
  const totals = filled.reduce(
    (acc, row) => {
      const value = Number(counted[row.id].replace(",", "."));
      const used = row.systemQty - value;
      if (used > 0) {
        acc.used += 1;
        acc.cost += used * row.averageCost;
      } else if (used < 0) acc.surplus += 1;
      return acc;
    },
    { used: 0, cost: 0, surplus: 0 },
  );

  return (
    <form
      action={registerCountAction}
      className="form"
      onSubmit={(event) => {
        if (!window.confirm(`Lançar ${totals.used} baixa(s) com custo estimado de ${money(totals.cost)}?`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="aba" value="contar" />

      <div className="filters" style={{ margin: "-20px -20px 0", borderTop: 0 }}>
        <div className="field grow">
          <label htmlFor="c-filter">Filtrar lista</label>
          <input id="c-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Ex.: chocolate" />
        </div>
        <div className="field">
          <label htmlFor="c-cat">Categoria</label>
          <select id="c-cat" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">Todas</option>
            {categories.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      </div>

      <fieldset disabled={disabled}>
        <div className="table-wrap" style={{ margin: "0 -20px" }}>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">No sistema</th>
                <th className="num" style={{ width: 140 }}>Contado (sobrou)</th>
                <th className="num">Baixa</th>
                <th className="num">Custo da baixa</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const raw = counted[row.id] ?? "";
                const value = Number(raw.replace(",", "."));
                const used = raw === "" ? null : row.systemQty - value;
                const hidden =
                  (filter && !normalize(row.name).includes(normalize(filter))) || (category && row.categoryName !== category);
                return (
                  <tr key={row.id} style={hidden ? { display: "none" } : undefined}>
                    <td>
                      <strong>{row.name}</strong>
                      <span className="sub">{row.categoryName}</span>
                    </td>
                    <td className="num">{qty(row.systemQty)}</td>
                    <td className="num">
                      <div className="field">
                        <input
                          name={`contado_${row.id}`}
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={raw}
                          onChange={(event) => setCounted((current) => ({ ...current, [row.id]: event.target.value }))}
                          aria-label={`Quantidade contada de ${row.name}`}
                          style={{ textAlign: "right" }}
                        />
                      </div>
                    </td>
                    <td className="num">
                      {used === null ? (
                        <span className="muted">—</span>
                      ) : used > 0 ? (
                        `−${qty(used)}`
                      ) : used < 0 ? (
                        <span className="badge warning">sobra {qty(-used)}</span>
                      ) : (
                        <span className="muted">sem consumo</span>
                      )}
                    </td>
                    <td className="num">{used && used > 0 ? money(used * row.averageCost) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="lines-foot" style={{ marginTop: 16 }}>
          <span className="muted">
            {filled.length} de {rows.length} itens contados
            {totals.surplus ? ` · ${totals.surplus} com sobra (falta lançar compra?)` : ""}. Itens em branco não são alterados.
          </span>
          <div className="form-actions">
            <span className="total-box">{money(totals.cost)}</span>
            <button className="btn btn-primary" type="submit" disabled={!totals.used}>
              Lançar {totals.used || ""} baixa{totals.used === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
