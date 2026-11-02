import Link from "next/link";
import {
  archiveSupplierAction,
  deletePurchaseAction,
  reactivateSupplierAction,
  saveSupplierAction,
} from "@/app/actions";
import { FormCard } from "@/components/form-card";
import { PageIntro } from "@/components/page-intro";
import { Pill } from "@/components/pill";
import { TableCard } from "@/components/table-card";
import {
  getItems,
  getPaymentMethods,
  getPeriodContext,
  getPurchaseAnalysis,
  getPurchaseForEdit,
  getPurchaseMovementTypes,
  getPurchaseOverview,
  getPurchases,
  getSuppliers,
} from "@/lib/data";
import type { SearchParams } from "@/lib/types";
import { buildPeriodHref, currency, isoToday, quantity } from "@/lib/utils";
import { ConfirmSubmitButton, PurchaseForm } from "@/app/(sistema)/compras/purchase-form";

type PageProps = { searchParams?: Promise<SearchParams> };

function paramText(params: SearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function defaultDate(year: number, month: number) {
  const today = isoToday();
  if (today.startsWith(`${year}-${String(month).padStart(2, "0")}`)) return today;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function confidenceLabel(confidence: "high" | "medium" | "low") {
  if (confidence === "high") return "Base melhor";
  if (confidence === "medium") return "Base inicial";
  return "Poucos dados";
}

export default async function PurchasesPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const purchaseId = Number(paramText(params, "editCompra")) || 0;
  const supplierEditId = Number(paramText(params, "editFornecedor")) || 0;
  const [
    periodContext,
    items,
    paymentMethods,
    movementTypes,
    suppliers,
    purchases,
    overview,
    analysis,
    purchase,
  ] = await Promise.all([
    getPeriodContext(params),
    getItems(),
    getPaymentMethods(),
    getPurchaseMovementTypes(),
    getSuppliers({ status: "all" }),
    getPurchases(params),
    getPurchaseOverview(params),
    getPurchaseAnalysis(params),
    getPurchaseForEdit(purchaseId),
  ]);
  const { selected, options } = periodContext;
  const supplierToEdit = suppliers.find((supplier) => supplier.id === supplierEditId) || null;
  const activeSuppliers = suppliers.filter(
    (supplier) => supplier.is_active === 1 || supplier.id === purchase?.supplier_id,
  );
  const filterParams = {
    supplierId: paramText(params, "supplierId") || undefined,
    destination: paramText(params, "destination") || undefined,
    q: paramText(params, "q") || undefined,
  };
  const hasFilters = Object.values(filterParams).some(Boolean);
  const errorMessage = paramText(params, "error");
  const noticeMessage = paramText(params, "notice");

  return (
    <div className="grid">
      <PageIntro
        title="Compras"
        description="Registre uma nota uma única vez e envie cada item para o estoque ou para o financeiro imediato."
        options={options}
        selectedKey={`${selected.year}-${String(selected.month).padStart(2, "0")}`}
      />

      {errorMessage ? <div className="action-message error">{errorMessage}</div> : null}
      {noticeMessage ? <div className="action-message success">{noticeMessage}</div> : null}
      {selected.isClosed ? (
        <div className="period-lock-panel closed">
          <div>
            <div className="period-lock-eyebrow">Período protegido</div>
            <h2>{selected.label} está fechado</h2>
            <p>As compras permanecem para consulta, mas não podem ser incluídas, editadas ou excluídas.</p>
          </div>
          <Link className="secondary-button" href={buildPeriodHref("/financeiro", selected.year, selected.month)}>
            Ver fechamento
          </Link>
        </div>
      ) : null}

      <div className="purchase-summary-grid">
        <div className="highlight-card purchase-summary-card">
          <span>Compras integradas</span>
          <strong>{overview.purchaseCount}</strong>
          <small>Novo fluxo neste período</small>
        </div>
        <div className="highlight-card purchase-summary-card green">
          <span>Valor total</span>
          <strong>{currency(overview.totalAmount)}</strong>
          <small>Todos os destinos</small>
        </div>
        <div className="highlight-card purchase-summary-card amber">
          <span>Para estoque</span>
          <strong>{currency(overview.inventoryAmount)}</strong>
          <small>Vira entrada e depois CMV</small>
        </div>
        <div className="highlight-card purchase-summary-card coral">
          <span>Consumo e despesas</span>
          <strong>{currency(overview.financialAmount)}</strong>
          <small>Vai direto ao financeiro</small>
        </div>
      </div>

      <FormCard
        title={purchase ? `Editar compra ${purchase.id}` : "Nova compra completa"}
        subtitle="Fornecedor, data e pagamento são informados uma vez. O sistema gera todos os lançamentos automaticamente."
      >
        {!activeSuppliers.length ? (
          <div className="note-box">Cadastre o primeiro fornecedor abaixo antes de registrar uma compra.</div>
        ) : null}
        <PurchaseForm
          year={selected.year}
          month={selected.month}
          defaultDate={defaultDate(selected.year, selected.month)}
          disabled={selected.isClosed}
          suppliers={activeSuppliers}
          paymentMethods={paymentMethods}
          movementTypes={movementTypes}
          items={items}
          purchase={purchase}
        />
        {purchase ? (
          <div className="form-actions">
            <Link className="secondary-button" href={buildPeriodHref("/compras", selected.year, selected.month, filterParams)}>
              Cancelar edição
            </Link>
          </div>
        ) : null}
      </FormCard>

      <div className="columns purchase-support-columns">
        <FormCard
          title={supplierToEdit ? "Editar fornecedor" : "Cadastrar fornecedor"}
          subtitle="O fornecedor será escolhido apenas uma vez em cada compra."
        >
          <form action={saveSupplierAction} className="grid">
            <input type="hidden" name="id" value={supplierToEdit?.id || ""} />
            <input type="hidden" name="year" value={selected.year} />
            <input type="hidden" name="month" value={selected.month} />
            <div className="form-grid">
              <div className="field full">
                <label htmlFor="supplier-name">Nome</label>
                <input id="supplier-name" name="name" defaultValue={supplierToEdit?.name || ""} required />
              </div>
              <div className="field full">
                <label htmlFor="supplier-contact">Contato (opcional)</label>
                <input id="supplier-contact" name="contact" defaultValue={supplierToEdit?.contact || ""} />
              </div>
              <div className="field full">
                <label htmlFor="supplier-notes">Observação</label>
                <textarea id="supplier-notes" name="notes" defaultValue={supplierToEdit?.notes || ""} />
              </div>
            </div>
            <div className="form-actions">
              <button className="button" type="submit">{supplierToEdit ? "Salvar fornecedor" : "Adicionar fornecedor"}</button>
              {supplierToEdit ? (
                <Link className="secondary-button" href={buildPeriodHref("/compras", selected.year, selected.month)}>
                  Cancelar
                </Link>
              ) : null}
            </div>
          </form>
        </FormCard>

        <TableCard title={`Fornecedores (${overview.activeSupplierCount} ativos)`} subtitle="Arquivar não apaga o histórico das compras.">
          {suppliers.length ? (
            <table>
              <thead><tr><th>Fornecedor</th><th>Contato</th><th>Ações</th></tr></thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td><strong>{supplier.name}</strong>{supplier.is_active ? null : <div><Pill tone="warning">Arquivado</Pill></div>}</td>
                    <td>{supplier.contact || "-"}</td>
                    <td>
                      <div className="inline-actions">
                        <Link className="ghost-link" href={buildPeriodHref("/compras", selected.year, selected.month, { editFornecedor: supplier.id })}>Editar</Link>
                        <form action={supplier.is_active ? archiveSupplierAction : reactivateSupplierAction}>
                          <input type="hidden" name="id" value={supplier.id} />
                          <input type="hidden" name="year" value={selected.year} />
                          <input type="hidden" name="month" value={selected.month} />
                          <button className="secondary-button" type="submit">{supplier.is_active ? "Arquivar" : "Reativar"}</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty">Nenhum fornecedor cadastrado.</div>}
        </TableCard>
      </div>

      <div className="panel">
        <div className="page-header">
          <div><h2>Filtros das compras</h2><p>Localize uma nota pelo fornecedor, destino ou descrição.</p></div>
          {hasFilters ? <Link className="secondary-button" href={buildPeriodHref("/compras", selected.year, selected.month)}>Limpar filtros</Link> : null}
        </div>
        <form action="/compras" className="form-grid three">
          <input type="hidden" name="year" value={selected.year} />
          <input type="hidden" name="month" value={selected.month} />
          <div className="field"><label htmlFor="purchase-filter-supplier">Fornecedor</label><select id="purchase-filter-supplier" name="supplierId" defaultValue={filterParams.supplierId || ""}><option value="">Todos</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></div>
          <div className="field"><label htmlFor="purchase-filter-destination">Destino</label><select id="purchase-filter-destination" name="destination" defaultValue={filterParams.destination || ""}><option value="">Todos</option><option value="inventory">Estoque</option><option value="financial">Financeiro imediato</option></select></div>
          <div className="field"><label htmlFor="purchase-filter-q">Buscar</label><input id="purchase-filter-q" name="q" defaultValue={filterParams.q || ""} placeholder="Nota, item ou observação" /></div>
          <div className="field"><label>&nbsp;</label><button className="button" type="submit">Aplicar filtros</button></div>
        </form>
      </div>

      <TableCard title="Compras do período" subtitle="Cada compra mantém seus lançamentos de estoque e financeiro sincronizados.">
        {purchases.length ? (
          <table>
            <thead><tr><th>Data</th><th>Fornecedor</th><th>Nota</th><th>Pagamento</th><th>Itens</th><th className="numeric">Estoque</th><th className="numeric">Imediato</th><th className="numeric">Total</th><th>Ações</th></tr></thead>
            <tbody>
              {purchases.map((row) => (
                <tr key={row.id}>
                  <td>{row.purchase_date}</td><td><strong>{row.supplier_name}</strong></td><td>{row.invoice_number || "-"}</td><td>{row.payment_method_name}</td><td>{row.line_count}</td><td className="numeric">{currency(row.inventory_amount)}</td><td className="numeric">{currency(row.financial_amount)}</td><td className="numeric"><strong>{currency(row.total_amount)}</strong></td>
                  <td>{selected.isClosed ? <Pill tone="warning">Protegido</Pill> : <div className="inline-actions"><Link className="ghost-link" href={buildPeriodHref("/compras", selected.year, selected.month, { ...filterParams, editCompra: row.id })}>Editar</Link><form action={deletePurchaseAction}><input type="hidden" name="id" value={row.id} /><input type="hidden" name="year" value={selected.year} /><input type="hidden" name="month" value={selected.month} /><ConfirmSubmitButton>Excluir</ConfirmSubmitButton></form></div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">Nenhuma compra integrada neste período. Os lançamentos antigos continuam preservados nas telas originais.</div>}
      </TableCard>

      <TableCard title="Sinais para planejar compras" subtitle="Leitura preliminar dos meses com contagem. Não é uma ordem automática de compra.">
        <div className="analysis-caution">
          <strong>{analysis.isCurrentPeriodPartial ? "Contagem parcial" : "Contagem do período concluída"}</strong>
          <span>{analysis.latestCountDate ? `Última baixa considerada: ${analysis.latestCountDate}.` : "Ainda não há baixa neste período."}</span>
        </div>
        {analysis.insights.length ? (
          <table className="zebra-table">
            <thead><tr><th>Produto</th><th className="numeric">Datas de compra</th><th className="numeric">Recompras em até 7 dias</th><th className="numeric">Média por mês com contagem</th><th className="numeric">Saldo teórico</th><th>Confiança</th></tr></thead>
            <tbody>
              {analysis.insights.map((insight) => (
                <tr key={insight.itemId}><td><strong>{insight.itemName}</strong><div className="muted">Preço observado: {currency(insight.minimumUnitPrice)} a {currency(insight.maximumUnitPrice)}</div></td><td className="numeric">{insight.purchaseDays}</td><td className="numeric">{insight.closePurchaseIntervals}</td><td className="numeric">{quantity(insight.averageMonthlyUsage)}</td><td className="numeric">{quantity(insight.currentQuantity)}</td><td><Pill tone={insight.confidence === "high" ? "success" : "warning"}>{confidenceLabel(insight.confidence)}</Pill></td></tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">Ainda não há histórico suficiente para gerar sinais.</div>}
      </TableCard>
    </div>
  );
}
