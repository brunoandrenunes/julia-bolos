import { DreList, TrendChart } from "@/components/charts";
import { Badge, Card, Icon, PageHead, Stat, Tabs } from "@/components/ui";
import { getPeriodContext, getReportSnapshot } from "@/lib/data";
import type { SearchParams } from "@/lib/types";
import { buildPeriodHref, buildReportExportHref, currency, quantity, shortMonthLabel } from "@/lib/utils";
import { PeriodPicker } from "../_comum";

type PageProps = { searchParams?: Promise<SearchParams> };

export default async function RelatoriosPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const [{ selected, options, scope }, report] = await Promise.all([getPeriodContext(params), getReportSnapshot(params)]);
  const s = report.selectedSummary;
  const totals = report.annualSummary.totals;
  const isYear = scope === "year";
  const topCmv = [...report.items].filter((item) => item.cmv > 0).sort((a, b) => b.cmv - a.cmv).slice(0, 10);
  const margin = s.revenue > 0 ? s.netProfit / s.revenue : 0;

  return (
    <>
      <PageHead title="Relatórios" description={isYear ? `Consolidado de ${selected.year}` : `DRE de ${selected.label.toLowerCase()}`}>
        <a className="btn" href={buildReportExportHref(scope, selected.year, selected.month)}>
          <Icon name="download" /> Exportar CSV
        </a>
        <a className="btn" href="/api/backup">
          <Icon name="download" /> Backup completo
        </a>
        <PeriodPicker options={options} selected={selected} />
      </PageHead>

      <Tabs
        active={scope}
        tabs={[
          { key: "month", label: "Mês", href: buildPeriodHref("/relatorios", selected.year, selected.month, { scope: "month" }) },
          { key: "year", label: `Ano ${selected.year}`, href: buildPeriodHref("/relatorios", selected.year, selected.month, { scope: "year" }) },
        ]}
      />

      <div className="stats">
        <Stat label="Receita" value={currency(s.revenue)} />
        <Stat
          label={s.netProfit >= 0 ? "Lucro líquido" : "Prejuízo líquido"}
          value={currency(s.netProfit)}
          tone={s.netProfit >= 0 ? "pos" : "neg"}
          note={s.revenue > 0 ? `Margem de ${(margin * 100).toFixed(1).replace(".", ",")}%` : undefined}
        />
        <Stat label="Retiradas" value={currency(s.withdrawals)} />
        <Stat highlight label="Resultado" value={currency(s.result)} note={isYear ? "Soma dos meses" : "Lucro menos retiradas"} />
      </div>

      <div className="grid-2">
        <Card
          title={isYear ? `DRE consolidada de ${selected.year}` : `DRE de ${selected.label.toLowerCase()}`}
          description={report.summarySource === "snapshot" ? "Histórico resumido vindo da planilha" : "Calculada a partir dos lançamentos"}
          flush
        >
          <DreList summary={s} />
        </Card>
        <Card title={`Receita e resultado em ${selected.year}`}>
          <TrendChart
            points={report.monthlyRows.map((row) => ({
              label: shortMonthLabel(row.period.month),
              revenue: row.summary.revenue,
              result: row.summary.result,
            }))}
          />
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
                    {row.period.label.split(" ")[0]}{" "}
                    {row.summary.source === "snapshot" ? <Badge>resumo</Badge> : null}
                    {row.period.isClosed ? null : <Badge tone="success">aberto</Badge>}
                  </td>
                  <td className="num">{currency(row.summary.revenue)}</td>
                  <td className="num">{currency(row.summary.cmv)}</td>
                  <td className="num">{currency(row.summary.inputs)}</td>
                  <td className="num">{currency(row.summary.expenses)}</td>
                  <td className={`num ${row.summary.netProfit >= 0 ? "pos" : "neg"}`}>{currency(row.summary.netProfit)}</td>
                  <td className="num muted">
                    {row.summary.revenue > 0 ? `${((row.summary.netProfit / row.summary.revenue) * 100).toFixed(0)}%` : "—"}
                  </td>
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
                <td className="num">{totals.revenue > 0 ? `${((totals.netProfit / totals.revenue) * 100).toFixed(0)}%` : "—"}</td>
                <td className="num">{currency(totals.withdrawals)}</td>
                <td className="num">{currency(totals.result)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {!isYear ? (
        <div className="grid-2">
          <Card title="Maiores custos do mês (CMV)" description="Itens que mais pesaram no custo das vendas" flush>
            {topCmv.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Usado</th>
                      <th className="num">Custo</th>
                      <th className="num">% do CMV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCmv.map((item) => (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td className="num">{quantity(item.usageQty)}</td>
                        <td className="num">{currency(item.cmv)}</td>
                        <td className="num muted">{s.cmv > 0 ? `${((item.cmv / s.cmv) * 100).toFixed(1).replace(".", ",")}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">Sem baixas de estoque neste mês.</div>
            )}
          </Card>
          <Card title="Saldos no fim do mês" flush>
            <div className="list">
              {report.balances.map((row) => (
                <div className="list-row" key={row.paymentMethod}>
                  <span className="label">{row.paymentMethod}{row.kind === "liability" ? <span className="muted"> · a pagar</span> : null}</span>
                  <span className="num">{currency(row.final)}</span>
                </div>
              ))}
              <div className="list-row">
                <span className="label">Valor em estoque</span>
                <span className="num">{currency(s.stockValue)}</span>
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
