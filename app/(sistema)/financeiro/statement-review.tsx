"use client";

import { useState } from "react";
import { applyStatementAction } from "@/app/actions";
import type { ReviewLine, StatementAction } from "@/lib/extrato";

type Choice = {
  selected: boolean;
  action: StatementAction["action"];
  typeId: string;
  description: string;
  accountId: string;
};

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
const dateText = (value: string) => value.split("-").reverse().join("/");

export function StatementReview({
  lines,
  types,
  accounts,
  year,
  month,
}: {
  lines: ReviewLine[];
  types: { id: number; name: string; group: string }[];
  accounts: { id: number; name: string }[];
  year: number;
  month: number;
}) {
  const [choices, setChoices] = useState<Record<number, Choice>>(() =>
    Object.fromEntries(
      lines.map((line) => [
        line.id,
        {
          // Já lançado → vincular (marcado). Entrada com sugestão → lançar (marcada). Saída sem tipo → espera escolha.
          selected: Boolean(line.match) || Boolean(line.suggestedTypeId),
          action: line.match ? "vincular" : "lancar",
          typeId: line.suggestedTypeId ? String(line.suggestedTypeId) : "",
          description: line.suggestedDescription,
          accountId: "",
        },
      ]),
    ),
  );

  function update(id: number, changes: Partial<Choice>) {
    setChoices((current) => ({ ...current, [id]: { ...current[id], ...changes } }));
  }

  const selected = lines.filter((line) => choices[line.id]?.selected);
  const missing = selected.filter((line) => {
    const choice = choices[line.id];
    return (choice.action === "lancar" && !choice.typeId) || (choice.action === "transferir" && !choice.accountId);
  });
  const payload: StatementAction[] = selected.map((line) => {
    const choice = choices[line.id];
    return {
      lineId: line.id,
      action: choice.action,
      typeId: Number(choice.typeId) || null,
      description: choice.description,
      accountId: Number(choice.accountId) || null,
      match: choice.action === "vincular" && line.match ? { kind: line.match.kind, id: line.match.id } : null,
    };
  });
  const totals = selected.reduce(
    (sum, line) => ({ in: sum.in + Math.max(line.amount, 0), out: sum.out + Math.max(-line.amount, 0) }),
    { in: 0, out: 0 },
  );
  const allSelected = lines.length > 0 && selected.length === lines.length;

  return (
    <form action={applyStatementAction}>
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <div className="table-wrap">
        <table className="statement-table">
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  aria-label="Marcar todas"
                  checked={allSelected}
                  onChange={(event) =>
                    setChoices((current) =>
                      Object.fromEntries(Object.entries(current).map(([id, choice]) => [id, { ...choice, selected: event.target.checked }])),
                    )
                  }
                />
              </th>
              <th>Data</th>
              <th>Movimento</th>
              <th className="num">Valor</th>
              <th style={{ minWidth: 380 }}>O que fazer</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const choice = choices[line.id];
              const allowed = types.filter((type) => (line.amount > 0 ? type.group !== "expense" : type.group !== "income"));
              return (
                <tr key={line.id} className={choice.selected ? undefined : "muted-row"}>
                  <td>
                    <input type="checkbox" aria-label={`Marcar ${line.counterpart}`} checked={choice.selected} onChange={(event) => update(line.id, { selected: event.target.checked })} />
                  </td>
                  <td>{dateText(line.date)}</td>
                  <td>
                    <strong>{line.counterpart || line.description}</strong>
                    <span className="sub">{line.kind}</span>
                  </td>
                  <td className={`num ${line.amount > 0 ? "pos" : "neg"}`}>{line.amount > 0 ? "+" : "−"} {money(Math.abs(line.amount))}</td>
                  <td>
                    <div className="statement-choice">
                      <select
                        aria-label="Ação"
                        value={choice.action}
                        onChange={(event) => update(line.id, { action: event.target.value as Choice["action"], selected: true })}
                      >
                        {line.match ? <option value="vincular">Já lançado: vincular</option> : null}
                        <option value="lancar">Lançar como novo</option>
                        <option value="transferir">Transferência entre contas</option>
                        <option value="ignorar">Ignorar</option>
                      </select>
                      {choice.action === "lancar" ? (
                        <>
                          <select aria-label="Tipo" value={choice.typeId} onChange={(event) => update(line.id, { typeId: event.target.value, selected: true })}>
                            <option value="">Tipo…</option>
                            {allowed.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                          </select>
                          <input aria-label="Descrição" value={choice.description} onChange={(event) => update(line.id, { description: event.target.value })} placeholder="Descrição" />
                        </>
                      ) : null}
                      {choice.action === "transferir" ? (
                        <select aria-label="Outra conta" value={choice.accountId} onChange={(event) => update(line.id, { accountId: event.target.value, selected: true })}>
                          <option value="">{line.amount < 0 ? "Para a conta…" : "Veio da conta…"}</option>
                          {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                        </select>
                      ) : null}
                    </div>
                    {choice.action === "vincular" && line.match ? (
                      <span className="sub">{line.match.label}</span>
                    ) : choice.action === "lancar" && line.learned ? (
                      <span className="sub">sugestão: igual à última vez com este pagador/recebedor</span>
                    ) : choice.action === "lancar" && line.match ? (
                      <span className="sub warn-text">Atenção: parece já lançado ({line.match.label}). Lançar de novo duplica.</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="filters" style={{ borderTop: "1px solid var(--border)", borderBottom: 0 }}>
        <span className="muted" style={{ flex: 1 }}>
          {selected.length} de {lines.length} marcadas · entradas {money(totals.in)} · saídas {money(totals.out)}
          {missing.length ? ` · falta escolher o tipo/conta em ${missing.length}` : ""}
        </span>
        <button className="btn btn-primary" type="submit" disabled={!selected.length || missing.length > 0}>
          Aplicar às marcadas
        </button>
      </div>
    </form>
  );
}
