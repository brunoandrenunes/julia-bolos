import Link from "next/link";
import { FormCard } from "@/components/form-card";
import { PageIntro } from "@/components/page-intro";
import { Pill } from "@/components/pill";
import { TableCard } from "@/components/table-card";
import {
  closePeriodAction,
  deleteFinancialTransactionAction,
  deleteTransferAction,
  reopenPeriodAction,
  saveFinancialTransactionAction,
  saveTransferAction,
} from "@/app/actions";
import {
  getDashboardSummary,
  getEditBundle,
  getFinancialTransactions,
  getItems,
  getMovementTypes,
  getPaymentMethods,
  getPeriodContext,
  getTransfers,
} from "@/lib/data";
import type { SearchParams } from "@/lib/types";
import { buildPeriodHref, currency, isoToday } from "@/lib/utils";

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

function paramText(params: SearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function dateInputValue(value?: string | null) {
  if (!value) return isoToday();
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);

  const parts = value.split(/[/-]/);
  if (parts.length === 3) {
    const [day, month, year] = parts;
    if (year?.length === 4) {
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
  }

  return isoToday();
}

export default async function FinanceiroPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const [{ selected, options }, paymentMethods, movementTypes, items, transactions, transfers, editBundle, dashboard] =
    await Promise.all([
      getPeriodContext(params),
      getPaymentMethods(),
      getMovementTypes(),
      getItems(),
      getFinancialTransactions(params),
      getTransfers(params),
      getEditBundle(params),
      getDashboardSummary(params),
    ]);

  const filterParams = {
    paymentMethodId: paramText(params, "paymentMethodId") || undefined,
    movementTypeId: paramText(params, "movementTypeId") || undefined,
    itemId: paramText(params, "itemId") || undefined,
    source: paramText(params, "source") || undefined,
    q: paramText(params, "q") || undefined,
  };
  const hasFilters = Object.values(filterParams).some(Boolean);
  const errorMessage = paramText(params, "error");
  const noticeMessage = paramText(params, "notice");

  return (
    <div className="grid">
      <PageIntro
        title="Financeiro"
        description="Receitas, insumos, despesas, retiradas e transferências entre contas em um único fluxo."
        options={options}
        selectedKey={`${selected.year}-${String(selected.month).padStart(2, "0")}`}
      />

      {errorMessage ? <div className="action-message error">{errorMessage}</div> : null}
      {noticeMessage ? <div className="action-message success">{noticeMessage}</div> : null}

      <div className={`period-lock-panel ${selected.isClosed ? "closed" : "open"}`}>
        <div>
          <div className="period-lock-eyebrow">Segurança do período</div>
          <h2>{selected.isClosed ? `${selected.label} está fechado` : `${selected.label} está em aberto`}</h2>
          <p>
            {selected.isClosed
              ? "Os dados continuam disponíveis para consulta, mas nenhum lançamento pode ser incluído, editado ou excluído."
              : "Enquanto estiver aberto, os lançamentos podem ser incluídos e corrigidos normalmente."}
          </p>
        </div>
        {selected.isClosed ? (
          <form action={reopenPeriodAction} className="period-lock-action">
            <input type="hidden" name="year" value={selected.year} />
            <input type="hidden" name="month" value={selected.month} />
            <label className="confirmation-check">
              <input type="checkbox" name="confirmReopen" value="yes" required />
              Confirmo que preciso alterar lançamentos deste mês.
            </label>
            <button className="secondary-button" type="submit">Reabrir período</button>
          </form>
        ) : (
          <form action={closePeriodAction} className="period-lock-action">
            <input type="hidden" name="year" value={selected.year} />
            <input type="hidden" name="month" value={selected.month} />
            <button className="button" type="submit">Fechar e proteger período</button>
          </form>
        )}
      </div>

      <div className="pill-row">
        {dashboard.balances.map((balance) => (
          <Pill key={balance.paymentMethod} tone={balance.kind === "asset" ? "success" : "warning"}>
            {balance.paymentMethod}: {currency(balance.final)}
          </Pill>
        ))}
      </div>

      <div className="panel">
        <div className="page-header">
          <div>
            <h2>Filtros dos lançamentos</h2>
            <p>Use para conferir lançamentos por forma de pagamento, tipo, item, origem ou texto.</p>
          </div>
          {hasFilters ? (
            <Link className="secondary-button" href={buildPeriodHref("/financeiro", selected.year, selected.month)}>
              Limpar filtros
            </Link>
          ) : null}
        </div>
        <form action="/financeiro" className="form-grid three">
          <input type="hidden" name="year" value={selected.year} />
          <input type="hidden" name="month" value={selected.month} />
          <div className="field">
            <label htmlFor="filter-payment">Forma de pagamento</label>
            <select id="filter-payment" name="paymentMethodId" defaultValue={filterParams.paymentMethodId || ""}>
              <option value="">Todas</option>
              {paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-type">Tipo</label>
            <select id="filter-type" name="movementTypeId" defaultValue={filterParams.movementTypeId || ""}>
              <option value="">Todos</option>
              {movementTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-item">Item relacionado</label>
            <select id="filter-item" name="itemId" defaultValue={filterParams.itemId || ""}>
              <option value="">Todos</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-source">Origem</label>
            <select id="filter-source" name="source" defaultValue={filterParams.source || ""}>
              <option value="">Todas</option>
              <option value="manual">Manual</option>
              <option value="purchase">Compra integrada</option>
              <option value="imported_excel">Importado</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-q">Buscar</label>
            <input id="filter-q" name="q" defaultValue={filterParams.q || ""} placeholder="Descrição, item ou observação" />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button className="button" type="submit">
              Aplicar filtros
            </button>
          </div>
        </form>
      </div>

      <div className="columns">
        <FormCard
          title={editBundle.financialTransaction ? "Editar lançamento" : "Novo lançamento financeiro"}
          subtitle="Use Receita, Insumos, Despesa e Retirada. Outros ajustes podem ser adicionados sem mexer na DRE."
        >
          <form
            key={`financial-${editBundle.financialTransaction?.id || "new"}`}
            action={saveFinancialTransactionAction}
            className="grid"
          >
            <input type="hidden" name="id" value={editBundle.financialTransaction?.id || ""} />
            <input type="hidden" name="year" value={selected.year} />
            <input type="hidden" name="month" value={selected.month} />

            <fieldset className="form-fieldset" disabled={selected.isClosed}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="fin-date">Data</label>
                <input
                  id="fin-date"
                  type="date"
                  name="date"
                  defaultValue={dateInputValue(editBundle.financialTransaction?.movement_date)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="fin-payment">Forma de pagamento</label>
                <select
                  id="fin-payment"
                  name="paymentMethodId"
                  defaultValue={String(editBundle.financialTransaction?.payment_method_id ?? paymentMethods[0]?.id ?? "")}
                >
                  {paymentMethods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="fin-type">Tipo</label>
                <select
                  id="fin-type"
                  name="movementTypeId"
                  defaultValue={String(editBundle.financialTransaction?.movement_type_id ?? movementTypes[0]?.id ?? "")}
                >
                  {movementTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="fin-item">Item relacionado</label>
                <select id="fin-item" name="itemId" defaultValue={String(editBundle.financialTransaction?.item_id ?? "")}>
                  <option value="">Sem item vinculado</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field full">
                <label htmlFor="fin-description">Descrição</label>
                <input
                  id="fin-description"
                  name="description"
                  defaultValue={editBundle.financialTransaction?.description || ""}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="fin-amount">Valor</label>
                <input
                  id="fin-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  name="amount"
                  defaultValue={editBundle.financialTransaction?.amount ?? ""}
                  required
                />
              </div>
              <div className="field full">
                <label htmlFor="fin-notes">Observação</label>
                <textarea id="fin-notes" name="notes" defaultValue={editBundle.financialTransaction?.notes || ""} />
              </div>
            </div>

            <div className="form-actions">
              <button className="button" type="submit">
                {editBundle.financialTransaction ? "Salvar lançamento" : "Registrar lançamento"}
              </button>
              {editBundle.financialTransaction ? (
                <Link className="secondary-button" href={buildPeriodHref("/financeiro", selected.year, selected.month, filterParams)}>
                  Cancelar
                </Link>
              ) : null}
            </div>
            </fieldset>
          </form>
        </FormCard>

        <FormCard
          title={editBundle.transfer ? "Editar transferência" : "Transferência entre contas"}
          subtitle="Ideal para pagamento do cartão, reforço de caixa ou reorganização entre contas."
        >
          <form
            key={`transfer-${editBundle.transfer?.id || "new"}`}
            action={saveTransferAction}
            className="grid"
          >
            <input type="hidden" name="id" value={editBundle.transfer?.id || ""} />
            <input type="hidden" name="year" value={selected.year} />
            <input type="hidden" name="month" value={selected.month} />

            <fieldset className="form-fieldset" disabled={selected.isClosed}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="transfer-date">Data</label>
                <input
                  id="transfer-date"
                  type="date"
                  name="date"
                  defaultValue={dateInputValue(editBundle.transfer?.movement_date)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="transfer-amount">Valor</label>
                <input
                  id="transfer-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  name="amount"
                  defaultValue={editBundle.transfer?.amount ?? ""}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="transfer-from">Sai de</label>
                <select
                  id="transfer-from"
                  name="fromPaymentMethodId"
                  defaultValue={String(editBundle.transfer?.from_payment_method_id ?? paymentMethods[0]?.id ?? "")}
                >
                  {paymentMethods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="transfer-to">Entra em</label>
                <select
                  id="transfer-to"
                  name="toPaymentMethodId"
                  defaultValue={String(editBundle.transfer?.to_payment_method_id ?? paymentMethods[1]?.id ?? "")}
                >
                  {paymentMethods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field full">
                <label htmlFor="transfer-description">Descrição</label>
                <input
                  id="transfer-description"
                  name="description"
                  defaultValue={editBundle.transfer?.description || "Transferência entre contas"}
                  required
                />
              </div>
              <div className="field full">
                <label htmlFor="transfer-notes">Observação</label>
                <textarea id="transfer-notes" name="notes" defaultValue={editBundle.transfer?.notes || ""} />
              </div>
            </div>

            <div className="form-actions">
              <button className="button" type="submit">
                {editBundle.transfer ? "Salvar transferência" : "Registrar transferência"}
              </button>
              {editBundle.transfer ? (
                <Link className="secondary-button" href={buildPeriodHref("/financeiro", selected.year, selected.month, filterParams)}>
                  Cancelar
                </Link>
              ) : null}
            </div>
            </fieldset>
          </form>
        </FormCard>
      </div>

      <div className="columns">
        <TableCard title="Lançamentos financeiros" subtitle="Fluxo que alimenta receita, insumos, despesas e retiradas.">
          {transactions.length ? (
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Pagamento</th>
                  <th>Tipo</th>
                  <th>Descrição</th>
                  <th className="numeric">Valor</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{transaction.movement_date}</td>
                    <td>{transaction.payment_method_name}</td>
                    <td>{transaction.movement_type_name}</td>
                    <td>
                      <strong>{transaction.description}</strong>
                      {transaction.item_name ? <div className="muted">{transaction.item_name}</div> : null}
                      {transaction.supplier_name ? (
                        <div className="muted">
                          {transaction.supplier_name}
                          {transaction.invoice_number ? ` | Nota ${transaction.invoice_number}` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="numeric">{currency(transaction.amount)}</td>
                    <td>
                      {selected.isClosed ? (
                        <Pill tone="warning">Protegido</Pill>
                      ) : transaction.purchase_id ? (
                        <Link
                          className="ghost-link"
                          href={buildPeriodHref("/compras", selected.year, selected.month, {
                            editCompra: transaction.purchase_id,
                          })}
                        >
                          Editar compra
                        </Link>
                      ) : (
                      <div className="inline-actions">
                        <Link
                          className="ghost-link"
                          href={buildPeriodHref("/financeiro", selected.year, selected.month, {
                            ...filterParams,
                            editLancamento: transaction.id,
                          })}
                        >
                          Editar
                        </Link>
                        <form action={deleteFinancialTransactionAction}>
                          <input type="hidden" name="id" value={transaction.id} />
                          <input type="hidden" name="year" value={selected.year} />
                          <input type="hidden" name="month" value={selected.month} />
                          <button className="danger-button" type="submit">
                            Excluir
                          </button>
                        </form>
                      </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">Nenhum lançamento financeiro encontrado com os filtros atuais.</div>
          )}
        </TableCard>

        <TableCard title="Transferências" subtitle="Movimentos neutros para o resultado, mas importantes para o saldo das contas.">
          {transfers.length ? (
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>De</th>
                  <th>Para</th>
                  <th className="numeric">Valor</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((transfer) => (
                  <tr key={transfer.id}>
                    <td>{transfer.movement_date}</td>
                    <td>{transfer.description}</td>
                    <td>{transfer.from_payment_method_name}</td>
                    <td>{transfer.to_payment_method_name}</td>
                    <td className="numeric">{currency(transfer.amount)}</td>
                    <td>
                      {selected.isClosed ? (
                        <Pill tone="warning">Protegido</Pill>
                      ) : (
                      <div className="inline-actions">
                        <Link
                          className="ghost-link"
                          href={buildPeriodHref("/financeiro", selected.year, selected.month, {
                            ...filterParams,
                            editTransferencia: transfer.id,
                          })}
                        >
                          Editar
                        </Link>
                        <form action={deleteTransferAction}>
                          <input type="hidden" name="id" value={transfer.id} />
                          <input type="hidden" name="year" value={selected.year} />
                          <input type="hidden" name="month" value={selected.month} />
                          <button className="danger-button" type="submit">
                            Excluir
                          </button>
                        </form>
                      </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">Nenhuma transferência encontrada com os filtros atuais.</div>
          )}
        </TableCard>
      </div>
    </div>
  );
}
