import Link from "next/link";
import { BarChart } from "@/components/bar-chart";
import { PageIntro } from "@/components/page-intro";
import { Pill } from "@/components/pill";
import { ReportScopeSwitch } from "@/components/report-scope-switch";
import { TableCard } from "@/components/table-card";
import { TrendChart } from "@/components/trend-chart";
import { getPeriodContext, getReportSnapshot } from "@/lib/data";
import type { SearchParams } from "@/lib/types";
import { buildReportExportHref, currency, quantity } from "@/lib/utils";

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

function valueClass(value: number) {
  if (value > 0) return "value-positive";
  if (value < 0) return "value-negative";
  return "";
}

function summaryRowClass(label: string, value: number) {
  if (label === "Receita") return "summary-row revenue";
  if (label === "Resultado final") return value >= 0 ? "summary-row profit" : "summary-row loss";
  if (label.includes("Lucro")) return "summary-row profit";
  if (label.includes("Prejuízo")) return "summary-row loss";
  return "summary-row expense";
}

export default async function RelatoriosPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const [{ selected, options, scope }, report] = await Promise.all([
    getPeriodContext(params),
    getReportSnapshot(params),
  ]);

  const profitLabel =
    report.selectedSummary.netProfit >= 0 ? "Lucro líquido" : "Prejuízo líquido";
  const activeInventoryItems = report.items.filter(
    (item) =>
      item.openingQty !== 0 ||
      item.entriesQty !== 0 ||
      item.usageQty !== 0 ||
      item.finalQty !== 0 ||
      item.cmv !== 0 ||
      item.finalValue !== 0,
  );

  const breakdownRows = [
    {
      label: "Receita",
      value: report.selectedSummary.revenue,
      note: "Base total de vendas do período.",
    },
    {
      label: "CMV",
      value: -report.selectedSummary.cmv,
      note: "Custo consumido pelo estoque no período.",
    },
    {
      label: "Insumos",
      value: -report.selectedSummary.inputs,
      note: "Compras e gastos lançados como insumos.",
    },
    {
      label: "Despesas",
      value: -report.selectedSummary.expenses,
      note: "Despesas operacionais e administrativas.",
    },
    {
      label: profitLabel,
      value: report.selectedSummary.netProfit,
      note:
        report.selectedSummary.netProfit >= 0
          ? "Saldo antes das retiradas."
          : "Perda antes das retiradas.",
    },
    {
      label: "Retiradas",
      value: -report.selectedSummary.withdrawals,
      note: "Valores retirados do caixa no período.",
    },
    {
      label: "Resultado final",
      value: report.selectedSummary.result,
      note:
        report.selectedSummary.result >= 0
          ? "Sobra após custos e retiradas."
          : "Ficou negativo após custos e retiradas.",
    },
  ];

  return (
    <div className="grid">
      <PageIntro
        title="Relatórios e DRE"
        description="Leitura mensal, consolidado anual, exportação CSV e comparativos entre os meses já apurados."
        options={options}
        selectedKey={`${selected.year}-${String(selected.month).padStart(2, "0")}`}
      />

      <div className="page-header">
        <ReportScopeSwitch pathname="/relatorios" scope={scope} year={selected.year} month={selected.month} />
        <div className="table-actions">
          <Link className="secondary-button" href={buildReportExportHref(scope, selected.year, selected.month)}>
            Exportar CSV com lançamentos
          </Link>
          <a className="secondary-button" href="/api/backup">
            Baixar backup completo
          </a>
        </div>
      </div>

      <div className="note-box">
        Base gerencial usada no DRE:{" "}
        {report.summarySource === "snapshot" ? "histórico mensal apurado" : "cálculo operacional do sistema"}.
        O consolidado anual soma os meses já disponíveis em {selected.year}.
      </div>

      <div className="dense-grid">
        <div className="highlight-card report-kpi revenue">
          <div className="metric-label">Receita</div>
          <div className="metric-value value-positive">{currency(report.selectedSummary.revenue)}</div>
          <div className="metric-note">Entrada total considerada no período.</div>
        </div>
        <div
          className={`highlight-card report-kpi ${
            report.selectedSummary.netProfit >= 0 ? "profit" : "loss"
          }`}
        >
          <div className="metric-label">{profitLabel}</div>
          <div className={`metric-value ${valueClass(report.selectedSummary.netProfit)}`}>
            {currency(report.selectedSummary.netProfit)}
          </div>
          <div className="metric-note">
            {report.selectedSummary.netProfit >= 0
              ? "Saldo antes das retiradas."
              : "Perda antes das retiradas."}
          </div>
        </div>
        <div
          className={`highlight-card report-kpi ${
            report.selectedSummary.result >= 0 ? "profit" : "loss"
          }`}
        >
          <div className="metric-label">Resultado final</div>
          <div className={`metric-value ${valueClass(report.selectedSummary.result)}`}>
            {currency(report.selectedSummary.result)}
          </div>
          <div className="metric-note">
            {report.selectedSummary.result >= 0
              ? "Fechamento positivo após retiradas."
              : "Fechamento negativo após retiradas."}
          </div>
        </div>
        <div className="highlight-card report-kpi stock">
          <div className="metric-label">Estoque final</div>
          <div className="metric-value">{currency(report.selectedSummary.stockValue)}</div>
          <div className="metric-note">
            {scope === "year"
              ? "Valor de estoque do último mês detalhado do ano."
              : "Valor final do estoque no mês selecionado."}
          </div>
        </div>
      </div>

      <div className="columns">
        <TrendChart
          title="Receita x resultado por mês"
          subtitle={`Comparativo em barras dos meses já apurados em ${selected.year}.`}
          points={report.monthlyRows.map((row) => ({
            label: row.period.label.split(" ")[0],
            revenue: row.summary.revenue,
            result: row.summary.result,
            netProfit: row.summary.netProfit,
          }))}
        />
        <BarChart
          title={scope === "year" ? "Leitura do ano" : "Leitura do mês"}
          subtitle="Cada linha mostra como o valor ajuda ou consome o resultado."
          rows={breakdownRows}
        />
      </div>

      <div className="columns">
        <TableCard
          title={scope === "year" ? `DRE consolidada ${selected.year}` : `DRE de ${report.period.label}`}
          subtitle="Resumo econômico do período com destaques visuais por tipo de linha."
        >
          <table className="summary-table">
            <thead>
              <tr>
                <th>Linha</th>
                <th className="numeric">Valor</th>
              </tr>
            </thead>
            <tbody>
              {report.dre.map((entry) => (
                <tr key={entry.label} className={summaryRowClass(entry.label, entry.value)}>
                  <td>
                    <strong>{entry.label}</strong>
                  </td>
                  <td className={`numeric ${valueClass(entry.value)}`}>{currency(entry.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>

        <TableCard title={`Meses de ${selected.year}`} subtitle="Comparativo mensal para leitura rápida e consolidação anual.">
          <table className="summary-table">
            <thead>
              <tr>
                <th>Mês</th>
                <th className="numeric">Receita</th>
                <th className="numeric">CMV</th>
                <th className="numeric">Insumos</th>
                <th className="numeric">Despesas</th>
                <th className="numeric">Lucro / Prejuízo</th>
                <th className="numeric">Retiradas</th>
                <th className="numeric">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {report.monthlyRows.map((row) => (
                <tr key={row.period.id}>
                  <td>{row.period.label}</td>
                  <td className={`numeric ${valueClass(row.summary.revenue)}`}>{currency(row.summary.revenue)}</td>
                  <td className="numeric">{currency(row.summary.cmv)}</td>
                  <td className="numeric">{currency(row.summary.inputs)}</td>
                  <td className="numeric">{currency(row.summary.expenses)}</td>
                  <td className={`numeric ${valueClass(row.summary.netProfit)}`}>{currency(row.summary.netProfit)}</td>
                  <td className="numeric">{currency(row.summary.withdrawals)}</td>
                  <td className={`numeric ${valueClass(row.summary.result)}`}>{currency(row.summary.result)}</td>
                </tr>
              ))}
              <tr className="summary-row total">
                <td>
                  <strong>{selected.year} consolidado</strong>
                </td>
                <td className="numeric value-positive">
                  <strong>{currency(report.annualSummary.totals.revenue)}</strong>
                </td>
                <td className="numeric">
                  <strong>{currency(report.annualSummary.totals.cmv)}</strong>
                </td>
                <td className="numeric">
                  <strong>{currency(report.annualSummary.totals.inputs)}</strong>
                </td>
                <td className="numeric">
                  <strong>{currency(report.annualSummary.totals.expenses)}</strong>
                </td>
                <td className={`numeric ${valueClass(report.annualSummary.totals.netProfit)}`}>
                  <strong>{currency(report.annualSummary.totals.netProfit)}</strong>
                </td>
                <td className="numeric">
                  <strong>{currency(report.annualSummary.totals.withdrawals)}</strong>
                </td>
                <td className={`numeric ${valueClass(report.annualSummary.totals.result)}`}>
                  <strong>{currency(report.annualSummary.totals.result)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </TableCard>
      </div>

      {scope === "month" ? (
        <>
          <div className="columns">
            <TableCard title="Saldos por conta" subtitle="Contas de disponibilidade e cartão de crédito do mês detalhado.">
              <table>
                <thead>
                  <tr>
                    <th>Conta</th>
                    <th>Natureza</th>
                    <th className="numeric">Inicial</th>
                    <th className="numeric">Movimentação</th>
                    <th className="numeric">Final</th>
                  </tr>
                </thead>
                <tbody>
                  {report.balances.map((balance) => (
                    <tr key={balance.paymentMethod}>
                      <td>{balance.paymentMethod}</td>
                      <td>
                        <Pill tone={balance.kind === "asset" ? "success" : "warning"}>
                          {balance.kind === "asset" ? "Disponível" : "Passivo"}
                        </Pill>
                      </td>
                      <td className="numeric">{currency(balance.opening)}</td>
                      <td className={`numeric ${valueClass(balance.movement)}`}>{currency(balance.movement)}</td>
                      <td className={`numeric ${valueClass(balance.final)}`}>{currency(balance.final)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>

            <TableCard title="Resumo do estoque do mês" subtitle="Valor e custo médio continuam vindo do detalhe operacional quando existir base detalhada.">
              <table>
                <thead>
                  <tr>
                    <th>Indicador</th>
                    <th className="numeric">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Valor do estoque final</td>
                    <td className="numeric">{currency(report.selectedSummary.stockValue)}</td>
                  </tr>
                  <tr>
                    <td>Itens com saldo final</td>
                    <td className="numeric">{activeInventoryItems.filter((item) => item.finalQty > 0).length}</td>
                  </tr>
                </tbody>
              </table>
            </TableCard>
          </div>

          {report.hasOperationalDetail ? (
            <TableCard title="Posição detalhada do estoque" subtitle="Itens sem saldo e sem movimentação no período ficam ocultos para facilitar a conferência.">
              {activeInventoryItems.length > 0 ? (
              <table className="zebra-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Categoria</th>
                    <th className="numeric">Inicial</th>
                    <th className="numeric">Entradas</th>
                    <th className="numeric">Saídas</th>
                    <th className="numeric">Saldo final</th>
                    <th className="numeric">CMV</th>
                    <th className="numeric">Valor final</th>
                  </tr>
                </thead>
                <tbody>
                  {activeInventoryItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{item.categoryName}</td>
                      <td className="numeric">{quantity(item.openingQty)}</td>
                      <td className="numeric">{quantity(item.entriesQty)}</td>
                      <td className="numeric">{quantity(item.usageQty)}</td>
                      <td className="numeric">{quantity(item.finalQty)}</td>
                      <td className="numeric">{currency(item.cmv)}</td>
                      <td className="numeric">{currency(item.finalValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              ) : (
                <div className="empty">
                  Nenhum item teve saldo ou movimentação de estoque neste período.
                </div>
              )}
            </TableCard>
          ) : (
            <div className="empty">
              Este mês tem apenas o consolidado gerencial importado. O detalhe operacional de estoque aparece a partir do ponto de corte usado na base.
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
