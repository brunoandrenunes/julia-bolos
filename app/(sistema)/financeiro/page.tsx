import Link from "next/link";
import {
  closePeriodAction,
  deleteFinancialTransactionAction,
  deleteTransferAction,
  reopenPeriodAction,
  saveFinancialTransactionAction,
  saveTransferAction,
} from "@/app/actions";
import { ConfirmButton, StandardDescriptionField } from "@/components/client-ui";
import { Alert, Badge, Card, Drawer, Empty, Flash, PageHead, PeriodHidden, Stat, Tabs } from "@/components/ui";
import {
  getEditBundle,
  getFinancialTransactions,
  getInventoryUsages,
  getMovementTypes,
  getPaymentMethods,
  getPeriodContext,
  getReportSnapshot,
  getTransfers,
} from "@/lib/data";
import type { SearchParams } from "@/lib/types";
import { getImmediateItems } from "@/lib/uso-imediato";
import { currency, formatDate, isoToday } from "@/lib/utils";
import { PeriodPicker, paramText, tabHref } from "../_comum";

type PageProps = { searchParams?: Promise<SearchParams> };

const TYPE_TONE: Record<string, "success" | "warning" | "danger" | "info" | "brand" | undefined> = {
  Receita: "success",
  Insumos: "warning",
  Despesa: "danger",
  Retirada: "brand",
};

function defaultDate(year: number, month: number) {
  const today = isoToday();
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return today.startsWith(prefix) ? today : `${prefix}-01`;
}

export default async function FinanceiroPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const requested = paramText(params, "aba");
  const tab = params.editTransferencia ? "transferencias" : params.editLancamento ? "lancamentos" : ["lancamentos", "transferencias", "fechamento"].includes(requested) ? requested : "lancamentos";
  const monthParams = { year: params.year, month: params.month, scope: "month" };
  const [{ selected, options }, paymentMethods, movementTypes, transactions, transfers, edit, report, usages, immediateItems] = await Promise.all([
    getPeriodContext(params),
    getPaymentMethods(),
    getMovementTypes(),
    getFinancialTransactions(params),
    getTransfers(params),
    getEditBundle(params),
    getReportSnapshot(monthParams),
    getInventoryUsages(monthParams),
    getImmediateItems(),
  ]);

  const s = report.selectedSummary;
  const locked = selected.isClosed;
  const tx = edit.financialTransaction;
  const transfer = edit.transfer;
  const filters = {
    paymentMethodId: paramText(params, "paymentMethodId") || undefined,
    movementTypeId: paramText(params, "movementTypeId") || undefined,
    q: paramText(params, "q") || undefined,
  };
  const hasFilters = Object.values(filters).some(Boolean);
  const filteredTotal = transactions.reduce((sum, row) => sum + row.amount, 0);
  const noCount = usages.length === 0 && report.summarySource !== "snapshot";

  return (
    <>
      <PageHead title="Financeiro" description="Receitas, gastos, retiradas, transferências e fechamento do mês.">
        <PeriodPicker options={options} selected={selected} />
      </PageHead>

      <Flash error={paramText(params, "error")} notice={paramText(params, "notice")} />
      {locked && tab !== "fechamento" ? (
        <Alert
          tone="info"
          title={`${selected.label} está fechado`}
          action={<Link className="btn btn-sm" href={tabHref("/financeiro", selected, "fechamento")}>Ver fechamento</Link>}
        >
          Os lançamentos ficam para consulta e não podem ser alterados.
        </Alert>
      ) : null}

      <div className="stats">
        <Stat label="Receita" value={currency(s.revenue)} />
        <Stat label="Insumos" value={currency(s.inputs)} note="Uso imediato" />
        <Stat label="Despesas" value={currency(s.expenses)} />
        <Stat label="Retiradas" value={currency(s.withdrawals)} />
      </div>

      <Tabs
        active={tab}
        tabs={[
          { key: "lancamentos", label: "Lançamentos", count: transactions.length, href: tabHref("/financeiro", selected, "lancamentos") },
          { key: "transferencias", label: "Transferências", count: transfers.length, href: tabHref("/financeiro", selected, "transferencias") },
          { key: "fechamento", label: locked ? "Fechamento · fechado" : "Fechamento do mês", href: tabHref("/financeiro", selected, "fechamento") },
        ]}
      />

      {tab === "lancamentos" ? (
        <>
          {!locked ? (
            <Drawer title={tx ? `Editar lançamento — ${tx.description}` : "Novo lançamento"} hint="receita, insumo, despesa ou retirada" open={Boolean(tx)}>
              <form action={saveFinancialTransactionAction} className="form" key={tx?.id || "novo"}>
                <input type="hidden" name="id" value={tx?.id || ""} />
                <input type="hidden" name="itemId" value={tx?.item_id || ""} />
                <PeriodHidden year={selected.year} month={selected.month} aba="lancamentos" />
                <div className="fields">
                  <div className="field">
                    <label htmlFor="t-type">Tipo</label>
                    <select id="t-type" name="movementTypeId" defaultValue={String(tx?.movement_type_id ?? movementTypes[0]?.id ?? "")}>
                      {movementTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="t-date">Data</label>
                    <input id="t-date" type="date" name="date" defaultValue={tx?.movement_date || defaultDate(selected.year, selected.month)} required />
                  </div>
                  <div className="field">
                    <label htmlFor="t-pay">Conta</label>
                    <select id="t-pay" name="paymentMethodId" defaultValue={String(tx?.payment_method_id ?? paymentMethods[0]?.id ?? "")}>
                      {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="t-amount">Valor</label>
                    <input id="t-amount" type="number" step="0.01" min="0.01" inputMode="decimal" name="amount" defaultValue={tx?.amount ?? ""} required />
                  </div>
                  <div className="field" style={{ gridColumn: "span 2" }}>
                    <label htmlFor="t-desc">Descrição</label>
                    <StandardDescriptionField
                      id="t-desc"
                      name="description"
                      defaultValue={tx?.description || ""}
                      options={immediateItems
                        .filter((item) => item.isActive)
                        .map((item) => ({ id: item.id, name: item.name, group: item.typeName }))}
                      placeholder="Ex.: Recebimentos, Entrega, Mão de obra"
                    />
                  </div>
                  <div className="field wide">
                    <label htmlFor="t-notes">Observação (opcional)</label>
                    <input id="t-notes" name="notes" defaultValue={tx?.notes || ""} />
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn btn-primary" type="submit">{tx ? "Salvar lançamento" : "Registrar lançamento"}</button>
                  {tx ? <Link className="btn btn-ghost" href={tabHref("/financeiro", selected, "lancamentos")}>Cancelar</Link> : null}
                </div>
              </form>
            </Drawer>
          ) : null}

          <Card flush>
            <form action="/financeiro" className="filters">
              <PeriodHidden year={selected.year} month={selected.month} aba="lancamentos" />
              <div className="field">
                <label htmlFor="f-type">Tipo</label>
                <select id="f-type" name="movementTypeId" defaultValue={filters.movementTypeId || ""}>
                  <option value="">Todos</option>
                  {movementTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-pay">Conta</label>
                <select id="f-pay" name="paymentMethodId" defaultValue={filters.paymentMethodId || ""}>
                  <option value="">Todas</option>
                  {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                </select>
              </div>
              <div className="field grow">
                <label htmlFor="f-q">Buscar</label>
                <input id="f-q" name="q" defaultValue={filters.q || ""} placeholder="Descrição ou observação" />
              </div>
              <button className="btn" type="submit">Filtrar</button>
              {hasFilters ? <Link className="btn btn-ghost" href={tabHref("/financeiro", selected, "lancamentos")}>Limpar</Link> : null}
            </form>
            {transactions.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Tipo</th>
                      <th>Descrição</th>
                      <th>Conta</th>
                      <th className="num">Valor</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDate(row.movement_date)}</td>
                        <td><Badge tone={TYPE_TONE[row.movement_type_name]}>{row.movement_type_name}</Badge></td>
                        <td>
                          <strong>{row.description}</strong>
                          {row.supplier_name ? <span className="sub">Compra · {row.supplier_name}</span> : row.notes ? <span className="sub">{row.notes}</span> : null}
                        </td>
                        <td>{row.payment_method_name}</td>
                        <td className={`num ${row.movement_type_name === "Receita" ? "pos" : ""}`}>{currency(row.amount)}</td>
                        <td>
                          <div className="row-actions">
                            {row.purchase_id ? (
                              <Link className="btn btn-sm btn-ghost" href={tabHref("/compras", selected, "registrar", { editCompra: row.purchase_id })}>Ver compra</Link>
                            ) : locked ? null : (
                              <>
                                <Link className="btn btn-sm btn-ghost" href={tabHref("/financeiro", selected, "lancamentos", { editLancamento: row.id })}>Editar</Link>
                                <form action={deleteFinancialTransactionAction}>
                                  <input type="hidden" name="id" value={row.id} />
                                  <PeriodHidden year={selected.year} month={selected.month} aba="lancamentos" />
                                  <ConfirmButton message={`Excluir o lançamento "${row.description}"?`}>Excluir</ConfirmButton>
                                </form>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {hasFilters ? (
                      <tr className="total">
                        <td colSpan={4}>Total filtrado</td>
                        <td className="num">{currency(filteredTotal)}</td>
                        <td />
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>{hasFilters ? "Nenhum lançamento com esses filtros." : "Nenhum lançamento neste mês."}</Empty>
            )}
          </Card>
        </>
      ) : null}

      {tab === "transferencias" ? (
        <>
          {!locked ? (
            <Drawer title={transfer ? "Editar transferência" : "Nova transferência"} hint="pagamento do cartão, depósito do dinheiro etc." open={Boolean(transfer)}>
              <form action={saveTransferAction} className="form" key={transfer?.id || "nova"}>
                <input type="hidden" name="id" value={transfer?.id || ""} />
                <PeriodHidden year={selected.year} month={selected.month} aba="transferencias" />
                <div className="fields">
                  <div className="field">
                    <label htmlFor="tr-date">Data</label>
                    <input id="tr-date" type="date" name="date" defaultValue={transfer?.movement_date || defaultDate(selected.year, selected.month)} required />
                  </div>
                  <div className="field">
                    <label htmlFor="tr-from">De</label>
                    <select id="tr-from" name="fromPaymentMethodId" defaultValue={String(transfer?.from_payment_method_id ?? paymentMethods[0]?.id ?? "")}>
                      {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="tr-to">Para</label>
                    <select id="tr-to" name="toPaymentMethodId" defaultValue={String(transfer?.to_payment_method_id ?? paymentMethods[paymentMethods.length - 1]?.id ?? "")}>
                      {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="tr-amount">Valor</label>
                    <input id="tr-amount" type="number" step="0.01" min="0.01" inputMode="decimal" name="amount" defaultValue={transfer?.amount ?? ""} required />
                  </div>
                  <div className="field" style={{ gridColumn: "span 2" }}>
                    <label htmlFor="tr-desc">Descrição</label>
                    <input id="tr-desc" name="description" defaultValue={transfer?.description || "Pagamento da fatura do cartão"} required />
                  </div>
                  <div className="field wide">
                    <label htmlFor="tr-notes">Observação (opcional)</label>
                    <input id="tr-notes" name="notes" defaultValue={transfer?.notes || ""} />
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn btn-primary" type="submit">{transfer ? "Salvar transferência" : "Registrar transferência"}</button>
                  {transfer ? <Link className="btn btn-ghost" href={tabHref("/financeiro", selected, "transferencias")}>Cancelar</Link> : null}
                </div>
              </form>
            </Drawer>
          ) : null}

          <div className="grid-3-1">
            <Card title="Transferências do mês" description="Não mudam o resultado, só onde o dinheiro está." flush>
              {transfers.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Descrição</th>
                        <th>De → Para</th>
                        <th className="num">Valor</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {transfers.map((row) => (
                        <tr key={row.id}>
                          <td>{formatDate(row.movement_date)}</td>
                          <td><strong>{row.description}</strong>{row.notes ? <span className="sub">{row.notes}</span> : null}</td>
                          <td>{row.from_payment_method_name} → {row.to_payment_method_name}</td>
                          <td className="num">{currency(row.amount)}</td>
                          <td>
                            {locked ? null : (
                              <div className="row-actions">
                                <Link className="btn btn-sm btn-ghost" href={tabHref("/financeiro", selected, "transferencias", { editTransferencia: row.id })}>Editar</Link>
                                <form action={deleteTransferAction}>
                                  <input type="hidden" name="id" value={row.id} />
                                  <PeriodHidden year={selected.year} month={selected.month} aba="transferencias" />
                                  <ConfirmButton message="Excluir esta transferência?">Excluir</ConfirmButton>
                                </form>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>Nenhuma transferência neste mês.</Empty>
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
              </div>
            </Card>
          </div>
        </>
      ) : null}

      {tab === "fechamento" ? (
        <div className="grid-2">
          <Card
            title={locked ? `${selected.label} está fechado` : `Fechar ${selected.label.toLowerCase()}`}
            description={locked ? "Nada pode ser incluído, alterado ou excluído neste mês." : "Depois de conferir tudo, feche o mês para protegê-lo de alterações acidentais."}
          >
            {locked ? (
              <form action={reopenPeriodAction} className="form">
                <PeriodHidden year={selected.year} month={selected.month} aba="fechamento" />
                <label className="check">
                  <input type="checkbox" name="confirmReopen" value="yes" required />
                  Entendo que reabrir permite alterar lançamentos e muda os saldos dos meses seguintes.
                </label>
                <div className="form-actions">
                  <button className="btn" type="submit">Reabrir mês</button>
                </div>
              </form>
            ) : (
              <form action={closePeriodAction} className="form">
                <PeriodHidden year={selected.year} month={selected.month} aba="fechamento" />
                {noCount ? (
                  <>
                    <Alert tone="warning" title="Este mês não tem contagem de estoque">
                      Se fechar assim, o CMV do mês fica zerado e o consumo vai todo para o mês da próxima contagem.
                    </Alert>
                    <label className="check">
                      <input type="checkbox" name="semContagem" value="sim" required />
                      Fechar mesmo sem contagem de estoque.
                    </label>
                  </>
                ) : null}
                <div className="form-actions">
                  <button className="btn btn-primary" type="submit">Fechar e proteger o mês</button>
                </div>
              </form>
            )}
          </Card>

          <Card title="Conferência antes de fechar" flush>
            <div className="list">
              <div className="list-row">
                <span className="label">Contagem de estoque</span>
                {noCount ? <Badge tone="warning">não lançada</Badge> : <Badge tone="success">{usages.length} baixas</Badge>}
              </div>
              <div className="list-row">
                <span className="label">Receita lançada</span>
                {s.revenue > 0 ? <span className="num">{currency(s.revenue)}</span> : <Badge tone="warning">nenhuma</Badge>}
              </div>
              <div className="list-row">
                <span className="label">CMV</span>
                <span className="num">{currency(s.cmv)}</span>
              </div>
              <div className="list-row">
                <span className="label">Resultado do mês</span>
                <span className={`num ${s.result >= 0 ? "pos" : "neg"}`}>{currency(s.result)}</span>
              </div>
              {report.balances.map((row) => (
                <div className="list-row" key={row.paymentMethod}>
                  <span className="label">Saldo {row.paymentMethod}</span>
                  <span className={`num ${row.final < 0 && row.kind === "asset" ? "neg" : ""}`}>{currency(row.final)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
