import Link from "next/link";
import {
  archiveImmediateItemAction,
  linkDescriptionsAction,
  reactivateImmediateItemAction,
  saveImmediateItemAction,
  unlinkImmediateItemAction,
} from "@/app/actions";
import { ConfirmButton } from "@/components/client-ui";
import { ColumnChart } from "@/components/report-charts";
import { Alert, Badge, Card, Drawer, Empty, PeriodHidden } from "@/components/ui";
import type { MovementType } from "@/lib/types";
import type { getImmediateTracking, ImmediateTrackingRow } from "@/lib/uso-imediato";
import { buildPeriodHref, currency, formatDate, percent, shortMonthLabel } from "@/lib/utils";

type Tracking = Awaited<ReturnType<typeof getImmediateTracking>>;

// Barrinhas do gasto de cada mês (a altura é relativa ao maior mês do próprio item).
function MiniBars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values, 0.01);
  return (
    <div className="minibars" aria-label={values.map((value, index) => `${labels[index]}: ${currency(value)}`).join("; ")}>
      {values.map((value, index) => (
        <span
          key={labels[index]}
          title={`${labels[index]}: ${currency(value)}`}
          className={index === values.length - 1 ? "current" : undefined}
          style={{ height: `${value > 0 ? Math.max((value / max) * 100, 6) : 0}%` }}
        />
      ))}
    </div>
  );
}

function spreadLabel(spread: number | null) {
  if (spread === null) return null;
  if (spread < 0.35) return "gasto estável";
  if (spread < 0.7) return "gasto varia";
  return "gasto irregular";
}

function VariationBadge({ row, monthIsOpen }: { row: ImmediateTrackingRow; monthIsOpen: boolean }) {
  if (row.variation === null) return <span className="sub">sem média anterior</span>;
  const pct = Math.round(row.variation * 100);
  const text = `${pct > 0 ? "+" : ""}${pct}% vs média`;
  if (monthIsOpen) return <span className="sub">{text} (mês em andamento)</span>;
  if (pct >= 25) return <Badge tone="warning">{text}</Badge>;
  if (pct <= -25) return <Badge tone="success">{text}</Badge>;
  return <span className="sub">{text}</span>;
}

export function UsoImediatoTab({
  data,
  movementTypes,
  editId,
  year,
  month,
}: {
  data: Tracking;
  movementTypes: MovementType[];
  editId: number;
  year: number;
  month: number;
}) {
  const labels = data.months.map((row) => shortMonthLabel(row.month));
  const active = data.rows.filter((row) => row.isActive).sort((a, b) => b.totalWindow - a.totalWindow);
  const archived = data.rows.filter((row) => !row.isActive);
  const editing = data.rows.find((row) => row.id === editId) || null;
  const activeItems = data.rows.filter((row) => row.isActive);
  const linkedTotal = data.totalsByMonth.reduce((sum, row) => sum + row.linked, 0);
  const unlinkedTotal = data.totalsByMonth.reduce((sum, row) => sum + row.unlinked, 0);
  const coverage = linkedTotal + unlinkedTotal > 0 ? linkedTotal / (linkedTotal + unlinkedTotal) : 0;
  const href = (extra: Record<string, string | number> = {}) =>
    buildPeriodHref("/reposicao", year, month, { aba: "imediato", ...extra });
  const insumos = movementTypes.find((type) => type.name === "Insumos")?.id;

  return (
    <>
      {data.rows.length === 0 ? (
        <Alert tone="info" title="Comece cadastrando os itens que se repetem">
          Morango, frutas, topper, entrega… Esses gastos não entram no estoque, mas com um nome fixo dá para ver
          quanto se gasta por mês e se o preço subiu. Use o formulário abaixo ou a lista &quot;Lançamentos sem item
          padrão&quot;, que já junta o que foi lançado com nomes diferentes (ex.: MORANGO, Morango).
        </Alert>
      ) : null}

      <Drawer
        title={editing ? `Editar item padrão — ${editing.name}` : "Cadastrar item padrão"}
        hint="insumo ou despesa de uso imediato"
        open={Boolean(editing)}
      >
        <form action={saveImmediateItemAction} className="form" key={editing?.id || "novo"}>
          <input type="hidden" name="id" value={editing?.id || ""} />
          <PeriodHidden year={year} month={month} aba="imediato" />
          <div className="fields">
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label htmlFor="ii-name">Nome</label>
              <input id="ii-name" name="name" defaultValue={editing?.name || ""} placeholder="Ex.: Morango, Framboesa, Topper" required />
            </div>
            <div className="field">
              <label htmlFor="ii-type">Tipo</label>
              <select id="ii-type" name="movementTypeId" defaultValue={String(editing?.movementTypeId || insumos || "")}>
                {movementTypes.map((type) => (
                  <option key={type.id} value={type.id}>{type.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ii-unit">Unidade de compra (opcional)</label>
              <input id="ii-unit" name="unitLabel" defaultValue={editing?.unitLabel || ""} placeholder="Ex.: bandeja 250 g, kg" />
            </div>
            <div className="field wide">
              <label htmlFor="ii-notes">Observação (opcional)</label>
              <input id="ii-notes" name="notes" defaultValue={editing?.notes || ""} />
            </div>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" type="submit">{editing ? "Salvar item" : "Cadastrar item"}</button>
            {editing ? <Link className="btn btn-ghost" href={href()}>Cancelar</Link> : null}
          </div>
        </form>
        {editing ? (
          <div className="form-actions" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <form action={editing.isActive ? archiveImmediateItemAction : reactivateImmediateItemAction}>
              <input type="hidden" name="id" value={editing.id} />
              <PeriodHidden year={year} month={month} aba="imediato" />
              <button className="btn btn-sm" type="submit">{editing.isActive ? "Arquivar item" : "Reativar item"}</button>
            </form>
            <form action={unlinkImmediateItemAction}>
              <input type="hidden" name="id" value={editing.id} />
              <PeriodHidden year={year} month={month} aba="imediato" />
              <ConfirmButton message={`Desfazer todos os vínculos de "${editing.name}"? Os lançamentos não mudam; só voltam para a lista sem item padrão.`}>
                Desfazer vínculos
              </ConfirmButton>
            </form>
          </div>
        ) : null}
      </Drawer>

      <Card
        title="Gasto com uso imediato por mês"
        description={`Insumos e despesas que não passam pelo estoque, nos últimos 6 meses. ${percent(coverage)} já está ligado a um item padrão.`}
      >
        <ColumnChart
          labels={labels}
          series={[
            { name: "Com item padrão", color: "var(--series-1)" },
            { name: "Sem item padrão", color: "var(--series-4)" },
          ]}
          values={[data.totalsByMonth.map((row) => row.linked), data.totalsByMonth.map((row) => row.unlinked)]}
          stacked
        />
      </Card>

      <Card
        title="Acompanhamento por item"
        description="Gasto mês a mês, comparação com a média dos meses anteriores e preço pago por unidade (quando a compra informa a quantidade)."
        flush
      >
        {active.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Últimos 6 meses</th>
                  <th className="num">Média/mês</th>
                  <th className="num">{data.monthIsOpen ? "Este mês" : "Mês selecionado"}</th>
                  <th className="num">Compras</th>
                  <th className="num">Preço por unidade</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {active.map((row) => {
                  const priceChange =
                    row.lastUnitPrice !== null && row.averageUnitPrice ? row.lastUnitPrice / row.averageUnitPrice - 1 : null;
                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.name}</strong>
                        <span className="sub">
                          {row.typeName}
                          {row.unitLabel ? ` · ${row.unitLabel}` : ""}
                          {spreadLabel(row.spread) ? ` · ${spreadLabel(row.spread)}` : ""}
                        </span>
                      </td>
                      <td><MiniBars values={row.monthly} labels={labels} /></td>
                      <td className="num">{currency(row.average)}</td>
                      <td className="num">
                        {currency(row.current)}
                        <div><VariationBadge row={row} monthIsOpen={data.monthIsOpen} /></div>
                      </td>
                      <td className="num">
                        {row.purchases}
                        <span className="sub">
                          {row.intervalDays !== null ? `a cada ≈ ${Math.max(Math.round(row.intervalDays), 1)} dias` : row.lastDate ? `última ${formatDate(row.lastDate)}` : "—"}
                        </span>
                      </td>
                      <td className="num">
                        {row.lastUnitPrice !== null ? currency(row.lastUnitPrice) : "—"}
                        {priceChange !== null && Math.abs(priceChange) >= 0.005 ? (
                          <span className="sub">
                            {priceChange > 0 ? "+" : ""}
                            {Math.round(priceChange * 100)}% vs média {currency(row.averageUnitPrice || 0)}
                          </span>
                        ) : row.averageUnitPrice ? (
                          <span className="sub">na média</span>
                        ) : null}
                      </td>
                      <td className="num">
                        <Link className="btn btn-sm btn-ghost" href={href({ editImediato: row.id })}>Editar</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Nenhum item padrão ainda.</Empty>
        )}
        {archived.length ? (
          <p className="muted" style={{ padding: "12px 20px", margin: 0 }}>
            Arquivados:{" "}
            {archived.map((row, index) => (
              <span key={row.id}>
                {index ? ", " : ""}
                <Link href={href({ editImediato: row.id })}>{row.name}</Link>
              </span>
            ))}
          </p>
        ) : null}
      </Card>

      <Card
        title="Lançamentos sem item padrão"
        description="Descrições iguais com acento ou maiúsculas diferentes aparecem juntas. Vincular não altera valor, data nem descrição: só classifica."
        flush
      >
        {data.unlinkedGroups.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Descrição</th>
                  <th>Tipo</th>
                  <th className="num">Lançamentos</th>
                  <th className="num">Total</th>
                  <th className="num">Último</th>
                  <th style={{ minWidth: 300 }}>Vincular a</th>
                </tr>
              </thead>
              <tbody>
                {data.unlinkedGroups.map((group) => (
                  <tr key={group.key}>
                    <td>
                      <strong>{group.label}</strong>
                      {group.variants.length > 1 ? <span className="sub">{group.variants.length} grafias juntas</span> : null}
                    </td>
                    <td>{group.typeName}</td>
                    <td className="num">{group.count}</td>
                    <td className="num">{currency(group.total)}</td>
                    <td className="num">{formatDate(group.lastDate)}</td>
                    <td>
                      <form action={linkDescriptionsAction} className="inline-form">
                        <PeriodHidden year={year} month={month} aba="imediato" />
                        <input type="hidden" name="typeName" value={group.typeName} />
                        <input type="hidden" name="newName" value={group.label} />
                        {group.variants.map((variant) => (
                          <input key={variant} type="hidden" name="variant" value={variant} />
                        ))}
                        <div className="field">
                          <select name="itemId" defaultValue={group.suggestedItemId ? String(group.suggestedItemId) : "novo"} aria-label={`Item padrão para ${group.label}`}>
                            <option value="novo">Novo item: {group.label}</option>
                            {activeItems.map((item) => (
                              <option key={item.id} value={item.id}>{item.name}</option>
                            ))}
                          </select>
                        </div>
                        <button className="btn btn-sm" type="submit">Vincular</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Todos os insumos e despesas de uso imediato já estão ligados a um item padrão.</Empty>
        )}
      </Card>
    </>
  );
}
