import { DreList, HBars, TrendChart } from "@/components/charts";
import { ColumnChart, LineChart } from "@/components/report-charts";
import { Badge, Card, Empty, Icon, PageHead, PeriodHidden, Stat, Tabs } from "@/components/ui";
import { getPriceHistory, getYearAnalytics } from "@/lib/analise";
import { getItems, getPeriodContext, getReportSnapshot } from "@/lib/data";
import type { SearchParams } from "@/lib/types";
import { buildPeriodHref, buildReportExportHref, currency, formatDate, quantity, shortMonthLabel } from "@/lib/utils";
import { PeriodPicker, paramText } from "../_comum";

type PageProps = { searchParams?: Promise<SearchParams> };

const TABS = [
  ["dre", "DRE"],
  ["vendas", "Vendas e margem"],
  ["custos", "Custos e despesas"],
  ["compras", "Compras"],
  ["estoque", "Estoque"],
  ["caixa", "Caixa e retiradas"],
] as const;

const S1 = "var(--series-1)";
const S2 = "var(--series-2)";
const S3 = "var(--series-3)";
const S4 = "var(--series-4)";

const pct = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")}%`;

export default async function RelatoriosPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const requested = paramText(params, "aba");
  const tab = TABS.some(([key]) => key === requested) ? requested : "dre";
  const { selected, options, scope } = await getPeriodContext(params);
  const href = (aba: string, extra?: Record<string, string>) =>
    buildPeriodHref("/relatorios", selected.year, selected.month, { aba, ...extra });

  return (
    <>
      <PageHead title="Relatórios" description={`Análises de ${selected.year} até ${selected.label.toLowerCase()}`}>
        <a className="btn" href={buildReportExportHref(scope, selected.year, selected.month)}>
          <Icon name="download" /> CSV
        </a>
        <a className="btn" href="/api/backup">
          <Icon name="download" /> Backup
        </a>
        <PeriodPicker options={options} selected={selected} />
      </PageHead>

      <Tabs active={tab} tabs={TABS.map(([key, label]) => ({ key, label, href: href(key) }))} />

      {tab === "dre" ? <DreTab params={params} scope={scope} /> : <AnalyticsTab tab={tab} params={params} href={href} />}
    </>
  );
}

async function DreTab({ params, scope }: { params: SearchParams; scope: "month" | "year" }) {
  const report = await getReportSnapshot(params);
  const s = report.selectedSummary;
  const totals = report.annualSummary.totals;
  const isYear = scope === "year";
  const topCmv = [...report.items].filter((item) => item.cmv > 0).sort((a, b) => b.cmv - a.cmv).slice(0, 10);
  const selected = report.period;

  return (
    <>
      <Tabs
        active={scope}
        tabs={[
          { key: "month", label: selected.label, href: buildPeriodHref("/relatorios", selected.year, selected.month, { aba: "dre", scope: "month" }) },
          { key: "year", label: `Acumulado ${selected.year}`, href: buildPeriodHref("/relatorios", selected.year, selected.month, { aba: "dre", scope: "year" }) },
        ]}
      />
      <div className="stats">
        <Stat label="Receita" value={currency(s.revenue)} />
        <Stat
          label={s.netProfit >= 0 ? "Lucro líquido" : "Prejuízo líquido"}
          value={currency(s.netProfit)}
          tone={s.netProfit >= 0 ? "pos" : "neg"}
          note={s.revenue > 0 ? `Margem de ${pct(s.netProfit / s.revenue)}` : undefined}
        />
        <Stat label="Retiradas" value={currency(s.withdrawals)} />
        <Stat highlight label="Resultado" value={currency(s.result)} note={isYear ? "Soma dos meses" : "Lucro menos retiradas"} />
      </div>
      <div className="grid-2">
        <Card title={isYear ? `DRE acumulada de ${selected.year}` : `DRE de ${selected.label.toLowerCase()}`} description={report.summarySource === "snapshot" ? "Histórico resumido vindo da planilha" : "Calculada a partir dos lançamentos"} flush>
          <DreList summary={s} />
        </Card>
        <Card title={`Receita e resultado em ${selected.year}`}>
          <TrendChart points={report.monthlyRows.map((row) => ({ label: shortMonthLabel(row.period.month), revenue: row.summary.revenue, result: row.summary.result }))} />
        </Card>
      </div>
      <Card title={`Mês a mês — ${selected.year}`} description="Contagens de estoque concentradas num mês distorcem o CMV daquele mês; o total do ano fica correto." flush>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mês</th>
                <th className="num">Receita</th>
                <th className="num">CMV</th>
                <th className="num">Insumos</th>
                <th className="num">Despesas</th>
                <th className="num">Lucro</th>
                <th className="num">Margem</th>
                <th className="num">Retiradas</th>
                <th className="num">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {report.monthlyRows.map((row) => (
                <tr key={row.period.id}>
                  <td>
                    {row.period.label.split(" ")[0]} {row.summary.source === "snapshot" ? <Badge>resumo</Badge> : null}
                    {row.period.isClosed ? null : <Badge tone="success">aberto</Badge>}
                  </td>
                  <td className="num">{currency(row.summary.revenue)}</td>
                  <td className="num">{currency(row.summary.cmv)}</td>
                  <td className="num">{currency(row.summary.inputs)}</td>
                  <td className="num">{currency(row.summary.expenses)}</td>
                  <td className={`num ${row.summary.netProfit >= 0 ? "pos" : "neg"}`}>{currency(row.summary.netProfit)}</td>
                  <td className="num muted">{row.summary.revenue > 0 ? pct(row.summary.netProfit / row.summary.revenue) : "—"}</td>
                  <td className="num">{currency(row.summary.withdrawals)}</td>
                  <td className={`num ${row.summary.result >= 0 ? "pos" : "neg"}`}>{currency(row.summary.result)}</td>
                </tr>
              ))}
              <tr className="total">
                <td>Total</td>
                <td className="num">{currency(totals.revenue)}</td>
                <td className="num">{currency(totals.cmv)}</td>
                <td className="num">{currency(totals.inputs)}</td>
                <td className="num">{currency(totals.expenses)}</td>
                <td className="num">{currency(totals.netProfit)}</td>
                <td className="num">{totals.revenue > 0 ? pct(totals.netProfit / totals.revenue) : "—"}</td>
                <td className="num">{currency(totals.withdrawals)}</td>
                <td className="num">{currency(totals.result)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      {!isYear ? (
        <Card title="Maiores custos do mês (CMV)" flush>
          {topCmv.length ? (
            <HBars rows={topCmv.map((item) => ({ label: item.name, value: item.cmv, sub: `${quantity(item.usageQty)} usados · ${s.cmv > 0 ? pct(item.cmv / s.cmv) : ""} do CMV` }))} />
          ) : (
            <Empty>Sem baixas de estoque neste mês.</Empty>
          )}
        </Card>
      ) : null}
    </>
  );
}

async function AnalyticsTab({
  tab,
  params,
  href,
}: {
  tab: string;
  params: SearchParams;
  href: (aba: string, extra?: Record<string, string>) => string;
}) {
  const data = await getYearAnalytics(params);
  const months = data.monthly;
  const labels = months.map((row) => shortMonthLabel(row.month));
  const detailed = months.filter((row) => row.summary.source !== "snapshot");
  const sum = (pick: (row: (typeof months)[number]) => number, rows = months) => rows.reduce((total, row) => total + pick(row), 0);
  const revenue = sum((row) => row.summary.revenue);
  const profit = sum((row) => row.summary.netProfit);

  if (tab === "vendas") {
    const best = [...months].sort((a, b) => b.summary.revenue - a.summary.revenue)[0];
    const worst = [...months].sort((a, b) => a.summary.revenue - b.summary.revenue)[0];
    const methods = Array.from(new Set(data.revenueByMethod.map((row) => row.method)));
    const last3 = months.slice(-3);
    const prev3 = months.slice(-6, -3);
    const growth = prev3.length ? sum((row) => row.summary.revenue, last3) / Math.max(sum((row) => row.summary.revenue, prev3), 1) - 1 : null;
    return (
      <>
        <div className="stats">
          <Stat label={`Receita ${data.year}`} value={currency(revenue)} note={`${months.length} meses`} />
          <Stat label="Média por mês" value={currency(revenue / Math.max(months.length, 1))} />
          <Stat label="Melhor mês" value={best ? shortMonthLabel(best.month) : "—"} note={best ? currency(best.summary.revenue) : undefined} />
          <Stat label="Margem líquida do ano" value={revenue > 0 ? pct(profit / revenue) : "—"} tone={profit >= 0 ? "pos" : "neg"} />
        </div>
        <div className="insight">
          {growth !== null ? (
            <>
              Nos últimos 3 meses a receita foi <strong>{growth >= 0 ? `${pct(growth)} maior` : `${pct(-growth)} menor`}</strong> que nos 3 meses anteriores.{" "}
            </>
          ) : null}
          O melhor mês foi <strong>{best?.label}</strong> ({currency(best?.summary.revenue || 0)}) e o mais fraco, <strong>{worst?.label}</strong> ({currency(worst?.summary.revenue || 0)}).
        </div>
        <div className="grid-2">
          <Card title="Receita por mês">
            <ColumnChart
              labels={labels}
              stacked
              series={[{ name: "Receita", color: S1 }]}
              values={[months.map((row) => row.summary.revenue)]}
            />
          </Card>
          <Card title="Margem líquida por mês" description="Lucro líquido ÷ receita">
            <LineChart labels={labels} format="percent" series={[{ name: "Margem", color: S1 }]} values={[months.map((row) => (row.summary.revenue > 0 ? row.summary.netProfit / row.summary.revenue : null))]} />
          </Card>
        </div>
        {methods.length ? (
          <Card title="Recebimentos por forma de pagamento" description="Meses com lançamento de receita detalhado">
            <ColumnChart
              labels={labels}
              stacked
              series={methods.map((method, index) => ({ name: method, color: [S1, S2, S3][index] || S4 }))}
              values={methods.map((method) => months.map((row) => data.revenueByMethod.find((r) => r.method === method && r.month === row.month)?.total || 0))}
            />
          </Card>
        ) : null}
      </>
    );
  }

  if (tab === "custos") {
    const cmv = sum((row) => row.summary.cmv);
    const inputs = sum((row) => row.summary.inputs);
    const expenses = sum((row) => row.summary.expenses);
    const despesas = data.expenses.filter((row) => row.type === "Despesa").slice(0, 10);
    const insumos = data.expenses.filter((row) => row.type === "Insumos").slice(0, 10);
    const twoMonthCmv = detailed.slice(-2);
    return (
      <>
        <div className="stats">
          <Stat label="CMV do ano" value={currency(cmv)} note={revenue > 0 ? `${pct(cmv / revenue)} da receita` : undefined} />
          <Stat label="Insumos" value={currency(inputs)} note={revenue > 0 ? `${pct(inputs / revenue)} da receita` : undefined} />
          <Stat label="Despesas" value={currency(expenses)} note={revenue > 0 ? `${pct(expenses / revenue)} da receita` : undefined} />
          <Stat label="Custo total" value={currency(cmv + inputs + expenses)} note={revenue > 0 ? `${pct((cmv + inputs + expenses) / revenue)} da receita` : undefined} />
        </div>
        <div className="insight">
          De cada R$ 100 vendidos em {data.year}, <strong>{revenue > 0 ? currency((100 * (cmv + inputs + expenses)) / revenue) : "—"}</strong> foram para ingredientes,
          embalagens e despesas. {twoMonthCmv.length === 2 && twoMonthCmv[0].summary.cmv === 0 ? `${twoMonthCmv[0].label} ficou sem contagem, por isso o CMV dele está zerado e o de ${twoMonthCmv[1].label} está dobrado.` : ""}
        </div>
        <Card title="Composição dos custos por mês">
          <ColumnChart
            labels={labels}
            stacked
            series={[
              { name: "CMV", color: S1 },
              { name: "Insumos", color: S2 },
              { name: "Despesas", color: S3 },
            ]}
            values={[months.map((row) => row.summary.cmv), months.map((row) => row.summary.inputs), months.map((row) => row.summary.expenses)]}
          />
        </Card>
        <div className="grid-2">
          <Card title="Despesas por tipo" description={`${data.year}, agrupadas pela descrição do lançamento`} flush>
            {despesas.length ? <HBars rows={despesas.map((row) => ({ label: row.label, value: row.total, sub: `${row.count} lançamentos` }))} color={S3} /> : <Empty>Sem despesas.</Empty>}
          </Card>
          <Card title="Insumos de uso imediato" description="Morango, topper e outros que não passam pelo estoque" flush>
            {insumos.length ? <HBars rows={insumos.map((row) => ({ label: row.label, value: row.total, sub: `${row.count} lançamentos` }))} color={S2} /> : <Empty>Sem insumos.</Empty>}
          </Card>
        </div>
        <Card title="CMV por categoria" flush>
          <HBars rows={data.cmvByCategory.map((row) => ({ label: row.category, value: row.cmv, sub: cmv > 0 ? `${pct(row.cmv / cmv)} do CMV` : undefined }))} />
        </Card>
      </>
    );
  }

  if (tab === "compras") {
    const items = await getItems();
    const defaultItem = data.cmvByItem[0] ? items.find((item) => item.name === data.cmvByItem[0].name)?.id : items[0]?.id;
    const itemId = Number(paramText(params, "item")) || defaultItem || 0;
    const history = await getPriceHistory(itemId);
    const itemName = items.find((item) => item.id === itemId)?.name || "";
    const trips = data.buyDays;
    const tripMonths = months.filter((row) => trips.some((t) => t.month === row.month));
    const recentTrips = trips.filter((row) => row.month >= Math.max(...trips.map((t) => t.month), 0) - 2);
    const tripsPerWeek = recentTrips.length ? recentTrips.reduce((total, row) => total + row.days, 0) / (recentTrips.length * 4.33) : 0;
    const supplierTotal = data.suppliers.reduce((total, row) => total + row.total, 0);
    const prices = history.map((row) => row.unitPrice);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const lastPrice = prices[prices.length - 1] || 0;
    return (
      <>
        <div className="stats">
          <Stat label="Idas às compras por semana" value={tripsPerWeek ? tripsPerWeek.toFixed(1).replace(".", ",") : "—"} note="Média dos últimos 3 meses" />
          <Stat label="Comprado com nota" value={currency(supplierTotal)} note={`${data.suppliers.length} fornecedores`} />
          <Stat label="Maior fornecedor" value={data.suppliers[0]?.supplier || "—"} note={data.suppliers[0] && supplierTotal ? `${pct(data.suppliers[0].total / supplierTotal)} das compras` : undefined} />
          {data.paymentSplit.length ? (
            <Stat label="Pago no cartão" value={pct((data.paymentSplit.find((row) => row.method.startsWith("Cart"))?.total || 0) / Math.max(data.paymentSplit.reduce((t, r) => t + r.total, 0), 1))} note="Das compras e despesas do ano" />
          ) : null}
        </div>
        <div className="insight">
          Em média são <strong>{tripsPerWeek.toFixed(1).replace(".", ",")} idas por semana</strong> para comprar algo. A aba <strong>Reposição</strong> sugere quantidades para
          comprar cada item a cada 14 dias e reduzir essas idas.
        </div>
        <div className="grid-2">
          <Card title="Dias com compra por mês" description="Dias distintos com nota, entrada de estoque ou insumo">
            <ColumnChart labels={tripMonths.map((row) => shortMonthLabel(row.month))} format="number" series={[{ name: "Dias com compra", color: S1 }]} values={[tripMonths.map((row) => trips.find((t) => t.month === row.month)?.days || 0)]} />
          </Card>
          <Card title="Fornecedores" description="Compras registradas pela aba Compras" flush>
            <HBars rows={data.suppliers.slice(0, 10).map((row) => ({ label: row.supplier, value: row.total, sub: `${row.notes} notas · ${row.days} dias · ticket ${currency(row.total / Math.max(row.notes, 1))}` }))} />
          </Card>
        </div>
        <Card
          title="Preço pago por unidade"
          description={itemName ? `${itemName} — menor ${currency(minPrice)}, último ${currency(lastPrice)}` : undefined}
          actions={
            <form action="/relatorios" className="form-actions">
              <PeriodHidden year={data.period.year} month={data.period.month} aba="compras" />
              <div className="field">
                <select name="item" defaultValue={String(itemId)} aria-label="Item">
                  {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>
              <button className="btn btn-sm" type="submit">Ver</button>
            </form>
          }
        >
          {history.length ? (
            <>
              <LineChart
                labels={history.map((row) => formatDate(row.date).slice(0, 5))}
                series={[{ name: "Preço por unidade", color: S1 }]}
                values={[history.map((row) => row.unitPrice)]}
                zeroBased={false}
              />
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Fornecedor</th>
                      <th className="num">Quantidade</th>
                      <th className="num">Por unidade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...history].reverse().slice(0, 8).map((row, index) => (
                      <tr key={`${row.date}-${index}`}>
                        <td>{formatDate(row.date)}</td>
                        <td>{row.supplier || <span className="muted">—</span>}</td>
                        <td className="num">{quantity(row.quantity)}</td>
                        <td className="num">
                          {currency(row.unitPrice)} {row.unitPrice === minPrice ? <Badge tone="success">menor</Badge> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <Empty>Nenhuma compra deste item.</Empty>
          )}
        </Card>
      </>
    );
  }

  if (tab === "estoque") {
    const stock = detailed.map((row) => row.summary.stockValue);
    const avgStock = stock.length ? stock.reduce((t, v) => t + v, 0) / stock.length : 0;
    const cmvDetailed = sum((row) => row.summary.cmv, detailed);
    const days = detailed.length * 30;
    const turnover = avgStock > 0 ? cmvDetailed / avgStock : 0;
    const coverage = cmvDetailed > 0 ? avgStock / (cmvDetailed / days) : 0;
    const topItems = data.cmvByItem.slice(0, 12);
    const cmvTotal = data.cmvByItem.reduce((t, row) => t + row.cmv, 0);
    const top5Share = cmvTotal > 0 ? data.cmvByItem.slice(0, 5).reduce((t, r) => t + r.cmv, 0) / cmvTotal : 0;
    return (
      <>
        <div className="stats">
          <Stat label="Estoque no fim do mês" value={currency(stock[stock.length - 1] || 0)} />
          <Stat label="Estoque médio" value={currency(avgStock)} note={`${detailed.length} meses com detalhe`} />
          <Stat label="Giro" value={turnover ? `${turnover.toFixed(1).replace(".", ",")}×` : "—"} note="CMV ÷ estoque médio no período" />
          <Stat label="Cobertura média" value={coverage ? `${Math.round(coverage)} dias` : "—"} note="Quanto o estoque dura, em média" />
        </div>
        <div className="insight">
          Os 5 itens que mais pesam respondem por <strong>{pct(top5Share)}</strong> do custo das vendas. Negociar preço e planejar a compra desses itens
          dá o maior retorno.
        </div>
        <div className="grid-2">
          <Card title="Valor do estoque no fim de cada mês">
            <ColumnChart labels={detailed.map((row) => shortMonthLabel(row.month))} series={[{ name: "Estoque", color: S1 }]} values={[stock]} />
          </Card>
          <Card title="CMV por mês" description="Custo do que foi usado (depende das contagens)">
            <ColumnChart labels={detailed.map((row) => shortMonthLabel(row.month))} series={[{ name: "CMV", color: S2 }]} values={[detailed.map((row) => row.summary.cmv)]} />
          </Card>
        </div>
        <Card title={`Itens que mais custaram em ${data.year}`} flush>
          <HBars rows={topItems.map((row) => ({ label: row.name, value: row.cmv, sub: `${quantity(row.used)} usados · ${cmvTotal > 0 ? pct(row.cmv / cmvTotal) : ""}` }))} />
        </Card>
      </>
    );
  }

  // caixa
  const withdrawals = sum((row) => row.summary.withdrawals);
  const months_over = months.filter((row) => row.summary.withdrawals > row.summary.netProfit && row.summary.revenue > 0);
  const balance = detailed.map((row) => row.summary.availableBalance);
  return (
    <>
      <div className="stats">
        <Stat label="Lucro líquido do ano" value={currency(profit)} tone={profit >= 0 ? "pos" : "neg"} />
        <Stat label="Retiradas do ano" value={currency(withdrawals)} note={profit > 0 ? `${pct(withdrawals / profit)} do lucro` : undefined} />
        <Stat label="Sobrou no negócio" value={currency(profit - withdrawals)} tone={profit - withdrawals >= 0 ? "pos" : "neg"} />
        <Stat label="Disponível hoje" value={currency(balance[balance.length - 1] || 0)} note="Pix + dinheiro − cartão" />
      </div>
      <div className="insight">
        Em <strong>{months_over.length}</strong> de {months.length} meses as retiradas foram maiores que o lucro
        {months_over.length ? ` (${months_over.map((row) => shortMonthLabel(row.month)).join(", ")})` : ""}. No ano, as retiradas consumiram{" "}
        <strong>{profit > 0 ? pct(withdrawals / profit) : "—"}</strong> do lucro.
      </div>
      <Card title="Lucro líquido × retiradas">
        <ColumnChart
          labels={labels}
          series={[
            { name: "Lucro líquido", color: S1 },
            { name: "Retiradas", color: S2 },
          ]}
          values={[months.map((row) => row.summary.netProfit), months.map((row) => row.summary.withdrawals)]}
        />
      </Card>
      <div className="grid-2">
        <Card title="Resultado do mês" description="Lucro menos retiradas">
          <ColumnChart labels={labels} polarity series={[{ name: "Resultado", color: S1 }]} values={[months.map((row) => row.summary.result)]} />
        </Card>
        <Card title="Saldo disponível no fim do mês" description="Pix + dinheiro − cartão">
          <LineChart labels={detailed.map((row) => shortMonthLabel(row.month))} series={[{ name: "Disponível", color: S1 }]} values={[balance]} />
        </Card>
      </div>
    </>
  );
}
