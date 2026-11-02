import { MetricCard } from "@/components/metric-card";
import { PageIntro } from "@/components/page-intro";
import { Pill } from "@/components/pill";
import { ReportScopeSwitch } from "@/components/report-scope-switch";
import { TableCard } from "@/components/table-card";
import { getDashboardSummary, getPeriodContext } from "@/lib/data";
import type { SearchParams } from "@/lib/types";
import { currency, quantity } from "@/lib/utils";

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const [{ selected, options, scope }, summary] = await Promise.all([
    getPeriodContext(params),
    getDashboardSummary(params),
  ]);

  return (
    <div className="grid">
      <PageIntro
        title="Dashboard"
        description="Visão simples do periodo selecionado, com foco no que precisa ser acompanhado no dia a dia."
        options={options}
        selectedKey={`${selected.year}-${String(selected.month).padStart(2, "0")}`}
      />

      <div className="page-header" style={{ marginTop: -8, marginBottom: 0 }}>
        <ReportScopeSwitch pathname="/" scope={scope} year={selected.year} month={selected.month} />
        <div className="pill-row">
          <Pill tone={summary.summarySource === "snapshot" ? "warning" : "success"}>
            {summary.summarySource === "snapshot" ? "Historico gerencial" : "Calculo operacional"}
          </Pill>
        </div>
      </div>

      <section className="metrics-grid">
        {summary.metrics.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={currency(metric.value)}
            note={metric.note}
          />
        ))}
      </section>

      <section className="split">
        <TableCard
          title="Contas e saldo disponivel"
          subtitle="Cada conta mostra saldo inicial, movimentacao liquida e saldo final."
        >
          <table>
            <thead>
              <tr>
                <th>Conta</th>
                <th>Tipo</th>
                <th className="numeric">Inicial</th>
                <th className="numeric">Movimentacao</th>
                <th className="numeric">Final</th>
              </tr>
            </thead>
            <tbody>
              {summary.balances.map((balance) => (
                <tr key={balance.paymentMethod}>
                  <td>{balance.paymentMethod}</td>
                  <td>
                    <Pill tone={balance.kind === "asset" ? "success" : "warning"}>
                      {balance.kind === "asset" ? "Disponivel" : "Passivo"}
                    </Pill>
                  </td>
                  <td className="numeric">{currency(balance.opening)}</td>
                  <td className="numeric">{currency(balance.movement)}</td>
                  <td className="numeric">{currency(balance.final)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>

        <div className="grid">
          <TableCard
            title={`Resumo anual ${selected.year}`}
            subtitle="Consolidado dos meses que ja possuem historico na base."
          >
            <table>
              <thead>
                <tr>
                  <th>Linha</th>
                  <th className="numeric">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Receita</td>
                  <td className="numeric">{currency(summary.annualTotals.revenue)}</td>
                </tr>
                <tr>
                  <td>CMV</td>
                  <td className="numeric">{currency(summary.annualTotals.cmv)}</td>
                </tr>
                <tr>
                  <td>Insumos</td>
                  <td className="numeric">{currency(summary.annualTotals.inputs)}</td>
                </tr>
                <tr>
                  <td>Despesas</td>
                  <td className="numeric">{currency(summary.annualTotals.expenses)}</td>
                </tr>
                <tr>
                  <td>Lucro liquido</td>
                  <td className="numeric">{currency(summary.annualTotals.netProfit)}</td>
                </tr>
                <tr>
                  <td>Retiradas</td>
                  <td className="numeric">{currency(summary.annualTotals.withdrawals)}</td>
                </tr>
                <tr>
                  <td>Resultado</td>
                  <td className="numeric">{currency(summary.annualTotals.result)}</td>
                </tr>
              </tbody>
            </table>
          </TableCard>

          <div className="panel">
            <div className="page-header">
              <div>
                <h2>Itens com estoque baixo</h2>
                <p>Baseado no estoque final comparado ao limite minimo configurado.</p>
              </div>
            </div>
            <div className="list">
              {summary.lowStockItems.length ? (
                summary.lowStockItems.map((item) => (
                  <div key={item.id} className="list-item">
                    <div>
                      <strong>{item.name}</strong>
                      <div className="muted">{item.categoryName}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <Pill tone={item.finalQty <= 0 ? "danger" : "warning"}>
                        {quantity(item.finalQty)} em estoque
                      </Pill>
                      <div className="muted">minimo {quantity(item.lowStockThreshold)}</div>
                    </div>
                  </div>
                ))
              ) : !summary.hasOperationalDetail ? (
                <div className="empty">
                  O periodo selecionado tem apenas historico gerencial. O alerta de estoque aparece quando houver detalhe operacional.
                </div>
              ) : (
                <div className="empty">Nenhum item abaixo do limite configurado neste mes.</div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
