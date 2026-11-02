import Link from "next/link";
import { DreList, TrendChart } from "@/components/charts";
import { Alert, Badge, Card, Empty, PageHead, Stat } from "@/components/ui";
import { getInventoryUsages, getPeriodContext, getPurchaseOverview, getReportSnapshot } from "@/lib/data";
import type { SearchParams } from "@/lib/types";
import { buildPeriodHref, currency, quantity, shortMonthLabel } from "@/lib/utils";
import { PeriodPicker, tabHref } from "./_comum";

type PageProps = { searchParams?: Promise<SearchParams> };

export default async function PainelPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const monthParams = { ...params, scope: "month" };
  const [{ selected, options }, report, usages, purchases] = await Promise.all([
    getPeriodContext(params),
    getReportSnapshot(monthParams),
    getInventoryUsages(monthParams),
    getPurchaseOverview(monthParams),
  ]);

  const s = report.selectedSummary;
  const costs = s.cmv + s.inputs + s.expenses;
  const margin = s.revenue > 0 ? s.netProfit / s.revenue : 0;
  const isSnapshot = report.summarySource === "snapshot";
  const available = report.balances.reduce(
    (sum, row) => (row.kind === "asset" ? sum + row.final : sum - row.final),
    0,
  );
  const lowStock = report.items
    .filter((item) => item.isActive && item.lowStockThreshold > 0 && item.finalQty <= item.lowStockThreshold)
    .sort((a, b) => a.finalQty - b.finalQty);
  const yearRevenue = report.monthlyRows.reduce((sum, row) => sum + row.summary.revenue, 0);
  const yearResult = report.monthlyRows.reduce((sum, row) => sum + row.summary.result, 0);

  return (
    <>
      <PageHead title="Painel" description={`Resumo de ${selected.label.toLowerCase()}`}>
        {selected.isClosed ? <Badge tone="info">Mês fechado</Badge> : <Badge tone="success">Mês aberto</Badge>}
        <PeriodPicker options={options} selected={selected} />
      </PageHead>

      {!isSnapshot && usages.length === 0 ? (
        <Alert
          tone="warning"
          title="Ainda não há contagem de estoque neste mês"
          action={
            <Link className="btn btn-sm" href={tabHref("/estoque", selected, "contagem")}>
              Lançar contagem
            </Link>
          }
        >
          Sem a baixa do estoque, o CMV do mês fica zerado e o próximo mês recebe o consumo acumulado.
        </Alert>
      ) : null}
      {isSnapshot ? (
        <Alert tone="info" title="Mês com histórico resumido">
          Este mês veio da planilha antiga só com os totais. Não há detalhe de estoque e lançamentos.
        </Alert>
      ) : null}

      <div className="stats">
        <Stat label="Receita" value={currency(s.revenue)} note="Vendas recebidas no mês" />
        <Stat
          label="Custos e despesas"
          value={currency(costs)}
          note={`CMV ${currency(s.cmv)} · Insumos ${currency(s.inputs)} · Despesas ${currency(s.expenses)}`}
        />
        <Stat
          label={s.netProfit >= 0 ? "Lucro líquido" : "Prejuízo líquido"}
          value={currency(s.netProfit)}
          tone={s.netProfit >= 0 ? "pos" : "neg"}
          note={s.revenue > 0 ? `Margem de ${(margin * 100).toFixed(1).replace(".", ",")}%` : undefined}
        />
        <Stat label="Retiradas" value={currency(s.withdrawals)} note="Saídas para uso pessoal" />
        <Stat highlight label="Resultado do mês" value={currency(s.result)} note="Lucro menos retiradas" />
      </div>

      <div className="grid-3-1">
        <Card
          title={`Ano de ${selected.year}`}
          description={`Receita ${currency(yearRevenue)} · Resultado ${currency(yearResult)}`}
          actions={
            <Link className="btn btn-sm btn-ghost" href={buildPeriodHref("/relatorios", selected.year, selected.month, { scope: "year" })}>
              Ver consolidado
            </Link>
          }
        >
          <TrendChart
            points={report.monthlyRows.map((row) => ({
              label: shortMonthLabel(row.period.month),
              revenue: row.summary.revenue,
              result: row.summary.result,
            }))}
          />
        </Card>

        <Card title="Saldos no fim do mês" flush>
          <div className="list">
            {report.balances.map((row) => (
              <div className="list-row" key={row.paymentMethod}>
                <span className="label">
                  {row.paymentMethod}
                  {row.kind === "liability" ? <span className="muted"> · a pagar</span> : null}
                </span>
                <span className="num">{currency(row.final)}</span>
              </div>
            ))}
            <div className="list-row total">
              <span>Disponível</span>
              <span className="num">{currency(available)}</span>
            </div>
            <div className="list-row">
              <span className="label">Valor em estoque</span>
              <span className="num">{currency(s.stockValue)}</span>
            </div>
            <div className="list-row">
              <span className="label">Compras do mês</span>
              <span className="num">
                {purchases.purchaseCount} {purchases.purchaseCount === 1 ? "nota" : "notas"} · {currency(purchases.totalAmount)}
              </span>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Resultado do mês" description="Quanto cada linha consome da receita" flush>
          <DreList summary={s} />
        </Card>

        <Card
          title="Abaixo do mínimo"
          description="Itens ativos com saldo no limite do estoque mínimo cadastrado"
          flush
          actions={
            <Link className="btn btn-sm btn-ghost" href={tabHref("/estoque", selected, "posicao")}>
              Ver estoque
            </Link>
          }
        >
          {lowStock.length ? (
            <div className="list">
              {lowStock.slice(0, 8).map((item) => (
                <div className="list-row" key={item.id}>
                  <span>
                    {item.name}
                    <span className="sub muted">mínimo {quantity(item.lowStockThreshold)}</span>
                  </span>
                  <Badge tone={item.finalQty <= 0 ? "danger" : "warning"}>
                    {item.finalQty <= 0 ? "zerado" : `${quantity(item.finalQty)} em estoque`}
                  </Badge>
                </div>
              ))}
              {lowStock.length > 8 ? (
                <div className="list-row muted">e mais {lowStock.length - 8} itens</div>
              ) : null}
            </div>
          ) : (
            <Empty>Nenhum item abaixo do mínimo.</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
