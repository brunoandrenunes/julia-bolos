import Link from "next/link";
import { FormCard } from "@/components/form-card";
import { PageIntro } from "@/components/page-intro";
import { Pill } from "@/components/pill";
import { TableCard } from "@/components/table-card";
import {
  deleteInventoryEntryAction,
  deleteInventoryUsageAction,
  saveInventoryEntryAction,
  saveInventoryUsageAction,
} from "@/app/actions";
import {
  getEditBundle,
  getInventoryEntries,
  getInventoryUsages,
  getItems,
  getPaymentMethods,
  getPeriodContext,
} from "@/lib/data";
import type { SearchParams } from "@/lib/types";
import { buildPeriodHref, currency, isoToday, quantity } from "@/lib/utils";

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

export default async function MovimentacoesPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const [{ selected, options }, items, paymentMethods, entries, usages, editBundle] = await Promise.all([
    getPeriodContext(params),
    getItems(),
    getPaymentMethods(),
    getInventoryEntries(params),
    getInventoryUsages(params),
    getEditBundle(params),
  ]);

  const filterParams = {
    paymentMethodId: paramText(params, "paymentMethodId") || undefined,
    itemId: paramText(params, "itemId") || undefined,
    source: paramText(params, "source") || undefined,
    q: paramText(params, "q") || undefined,
  };
  const hasFilters = Object.values(filterParams).some(Boolean);
  const errorMessage = paramText(params, "error");

  return (
    <div className="grid">
      <PageIntro
        title="Movimentações de estoque"
        description="Registre compras de estoque e consumo diário. As saídas alimentam automaticamente o CMV do período."
        options={options}
        selectedKey={`${selected.year}-${String(selected.month).padStart(2, "0")}`}
      />

      {errorMessage ? <div className="action-message error">{errorMessage}</div> : null}
      {selected.isClosed ? (
        <div className="period-lock-panel closed">
          <div>
            <div className="period-lock-eyebrow">Período protegido</div>
            <h2>{selected.label} está fechado</h2>
            <p>Entradas e saídas permanecem disponíveis para consulta, mas não podem ser alteradas.</p>
          </div>
          <Link
            className="secondary-button"
            href={buildPeriodHref("/financeiro", selected.year, selected.month)}
          >
            Ver fechamento no Financeiro
          </Link>
        </div>
      ) : null}

      <div className="panel">
        <div className="page-header">
          <div>
            <h2>Filtros das movimentações</h2>
            <p>Use para conferir entradas e saídas por pagamento, item, origem ou texto.</p>
          </div>
          {hasFilters ? (
            <Link className="secondary-button" href={buildPeriodHref("/movimentacoes", selected.year, selected.month)}>
              Limpar filtros
            </Link>
          ) : null}
        </div>
        <form action="/movimentacoes" className="form-grid three">
          <input type="hidden" name="year" value={selected.year} />
          <input type="hidden" name="month" value={selected.month} />
          <div className="field">
            <label htmlFor="filter-payment">Pagamento da entrada</label>
            <select id="filter-payment" name="paymentMethodId" defaultValue={filterParams.paymentMethodId || ""}>
              <option value="">Todos</option>
              {paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-item">Item</label>
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
            <input id="filter-q" name="q" defaultValue={filterParams.q || ""} placeholder="Item ou observação" />
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
          title={editBundle.inventoryEntry ? "Editar entrada de estoque" : "Nova entrada de estoque"}
          subtitle="Compras pagas em Pix e Dinheiro reduzem caixa. Compras em Cartão aumentam o saldo do cartão."
        >
          <form
            key={`entry-${editBundle.inventoryEntry?.id || "new"}`}
            action={saveInventoryEntryAction}
            className="grid"
          >
            <input type="hidden" name="id" value={editBundle.inventoryEntry?.id || ""} />
            <input type="hidden" name="year" value={selected.year} />
            <input type="hidden" name="month" value={selected.month} />

            <fieldset className="form-fieldset" disabled={selected.isClosed}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="entry-date">Data</label>
                <input
                  id="entry-date"
                  type="date"
                  name="date"
                  defaultValue={dateInputValue(editBundle.inventoryEntry?.movement_date)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="entry-payment">Pagamento</label>
                <select
                  id="entry-payment"
                  name="paymentMethodId"
                  defaultValue={String(editBundle.inventoryEntry?.payment_method_id ?? paymentMethods[0]?.id ?? "")}
                >
                  {paymentMethods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field full">
                <label htmlFor="entry-item">Item</label>
                <select
                  id="entry-item"
                  name="itemId"
                  defaultValue={String(editBundle.inventoryEntry?.item_id ?? items[0]?.id ?? "")}
                >
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="entry-quantity">Quantidade</label>
                <input
                  id="entry-quantity"
                  type="number"
                  step="0.01"
                  min="0.01"
                  name="quantity"
                  defaultValue={editBundle.inventoryEntry?.quantity ?? ""}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="entry-total">Valor total</label>
                <input
                  id="entry-total"
                  type="number"
                  step="0.01"
                  min="0.01"
                  name="totalAmount"
                  defaultValue={editBundle.inventoryEntry?.total_amount ?? ""}
                  required
                />
              </div>
              <div className="field full">
                <label htmlFor="entry-notes">Observação</label>
                <textarea id="entry-notes" name="notes" defaultValue={editBundle.inventoryEntry?.notes || ""} />
              </div>
            </div>

            <div className="form-actions">
              <button className="button" type="submit">
                {editBundle.inventoryEntry ? "Salvar entrada" : "Registrar entrada"}
              </button>
              {editBundle.inventoryEntry ? (
                <Link className="secondary-button" href={buildPeriodHref("/movimentacoes", selected.year, selected.month, filterParams)}>
                  Cancelar
                </Link>
              ) : null}
            </div>
            </fieldset>
          </form>
        </FormCard>

        <FormCard
          title={editBundle.inventoryUsage ? "Editar saída de estoque" : "Nova saída / consumo"}
          subtitle="A validação impede consumir mais do que existe no período."
        >
          <form
            key={`usage-${editBundle.inventoryUsage?.id || "new"}`}
            action={saveInventoryUsageAction}
            className="grid"
          >
            <input type="hidden" name="id" value={editBundle.inventoryUsage?.id || ""} />
            <input type="hidden" name="year" value={selected.year} />
            <input type="hidden" name="month" value={selected.month} />

            <fieldset className="form-fieldset" disabled={selected.isClosed}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="usage-date">Data</label>
                <input
                  id="usage-date"
                  type="date"
                  name="date"
                  defaultValue={dateInputValue(editBundle.inventoryUsage?.movement_date)}
                  required
                />
              </div>
              <div className="field full">
                <label htmlFor="usage-item">Item</label>
                <select
                  id="usage-item"
                  name="itemId"
                  defaultValue={String(editBundle.inventoryUsage?.item_id ?? items[0]?.id ?? "")}
                >
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="usage-quantity">Quantidade consumida</label>
                <input
                  id="usage-quantity"
                  type="number"
                  step="0.01"
                  min="0.01"
                  name="quantity"
                  defaultValue={editBundle.inventoryUsage?.quantity ?? ""}
                  required
                />
              </div>
              <div className="field full">
                <label htmlFor="usage-notes">Observação</label>
                <textarea id="usage-notes" name="notes" defaultValue={editBundle.inventoryUsage?.notes || ""} />
              </div>
            </div>

            <div className="form-actions">
              <button className="button" type="submit">
                {editBundle.inventoryUsage ? "Salvar saída" : "Registrar saída"}
              </button>
              {editBundle.inventoryUsage ? (
                <Link className="secondary-button" href={buildPeriodHref("/movimentacoes", selected.year, selected.month, filterParams)}>
                  Cancelar
                </Link>
              ) : null}
            </div>
            </fieldset>
          </form>
        </FormCard>
      </div>

      <div className="columns">
        <TableCard title="Entradas do período" subtitle="Compras de estoque importadas e lançadas manualmente.">
          {entries.length ? (
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Pagamento</th>
                  <th>Item</th>
                  <th className="numeric">Quantidade</th>
                  <th className="numeric">Valor</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.movement_date}</td>
                    <td>{entry.payment_method_name}</td>
                    <td>
                      <strong>{entry.item_name}</strong>
                      {entry.supplier_name ? (
                        <div className="muted">
                          {entry.supplier_name}
                          {entry.invoice_number ? ` | Nota ${entry.invoice_number}` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="numeric">{quantity(entry.quantity)}</td>
                    <td className="numeric">{currency(entry.total_amount)}</td>
                    <td>
                      {selected.isClosed ? (
                        <Pill tone="warning">Protegido</Pill>
                      ) : entry.purchase_id ? (
                        <Link
                          className="ghost-link"
                          href={buildPeriodHref("/compras", selected.year, selected.month, {
                            editCompra: entry.purchase_id,
                          })}
                        >
                          Editar compra
                        </Link>
                      ) : (
                      <div className="inline-actions">
                        <Link
                          className="ghost-link"
                          href={buildPeriodHref("/movimentacoes", selected.year, selected.month, {
                            ...filterParams,
                            editEntrada: entry.id,
                          })}
                        >
                          Editar
                        </Link>
                        <form action={deleteInventoryEntryAction}>
                          <input type="hidden" name="id" value={entry.id} />
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
            <div className="empty">Nenhuma entrada encontrada com os filtros atuais.</div>
          )}
        </TableCard>

        <TableCard title="Saídas / consumo do período" subtitle="Consumo diário que alimenta o CMV do mês.">
          {usages.length ? (
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Item</th>
                  <th className="numeric">Quantidade</th>
                  <th>Origem</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {usages.map((usage) => (
                  <tr key={usage.id}>
                    <td>{usage.movement_date}</td>
                    <td>{usage.item_name}</td>
                    <td className="numeric">{quantity(usage.quantity)}</td>
                    <td>{usage.source === "imported_excel" ? "Importado" : "Manual"}</td>
                    <td>
                      {selected.isClosed ? (
                        <Pill tone="warning">Protegido</Pill>
                      ) : (
                      <div className="inline-actions">
                        <Link
                          className="ghost-link"
                          href={buildPeriodHref("/movimentacoes", selected.year, selected.month, {
                            ...filterParams,
                            editSaida: usage.id,
                          })}
                        >
                          Editar
                        </Link>
                        <form action={deleteInventoryUsageAction}>
                          <input type="hidden" name="id" value={usage.id} />
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
            <div className="empty">Nenhuma saída encontrada com os filtros atuais.</div>
          )}
        </TableCard>
      </div>
    </div>
  );
}
