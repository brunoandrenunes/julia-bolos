import Link from "next/link";
import { archiveSupplierAction, deletePurchaseAction, reactivateSupplierAction, saveSupplierAction } from "@/app/actions";
import { ConfirmButton } from "@/components/client-ui";
import { Alert, Badge, Card, Drawer, Empty, Flash, PageHead, PeriodHidden, Stat, Tabs } from "@/components/ui";
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
import { currency, formatDate, isoToday, quantity } from "@/lib/utils";
import { getImmediateItems } from "@/lib/uso-imediato";
import { PurchaseForm } from "./purchase-form";
import { PeriodPicker, paramText, tabHref } from "../_comum";

type PageProps = { searchParams?: Promise<SearchParams> };

function defaultDate(year: number, month: number) {
  const today = isoToday();
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return today.startsWith(prefix) ? today : `${prefix}-01`;
}

const CONFIDENCE = {
  high: { label: "Boa base", tone: "success" as const },
  medium: { label: "Base inicial", tone: "warning" as const },
  low: { label: "Poucos dados", tone: undefined },
};

export default async function ComprasPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const purchaseId = Number(paramText(params, "editCompra")) || 0;
  const supplierEditId = Number(paramText(params, "editFornecedor")) || 0;
  const requestedTab = paramText(params, "aba");
  const [{ selected, options }, items, paymentMethods, movementTypes, suppliers, purchases, overview, analysis, purchase, immediateItems] =
    await Promise.all([
      getPeriodContext(params),
      getItems(),
      getPaymentMethods(),
      getPurchaseMovementTypes(),
      getSuppliers({ status: "all" }),
      getPurchases(params),
      getPurchaseOverview(params),
      getPurchaseAnalysis(params),
      getPurchaseForEdit(purchaseId),
      getImmediateItems(),
    ]);

  const tab = purchase ? "registrar" : ["registrar", "historico", "fornecedores", "sinais"].includes(requestedTab) ? requestedTab : "registrar";
  const activeSuppliers = suppliers.filter((supplier) => supplier.is_active === 1 || supplier.id === purchase?.supplier_id);
  const supplierToEdit = suppliers.find((supplier) => supplier.id === supplierEditId) || null;
  const filters = {
    supplierId: paramText(params, "supplierId") || undefined,
    destination: paramText(params, "destination") || undefined,
    q: paramText(params, "q") || undefined,
  };
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHead title="Compras" description="Cada nota é lançada uma vez: os produtos vão para o estoque e o que é de uso imediato vai para o financeiro.">
        <PeriodPicker options={options} selected={selected} />
      </PageHead>

      <Flash error={paramText(params, "error")} notice={paramText(params, "notice")} />
      {selected.isClosed ? (
        <Alert tone="info" title={`${selected.label} está fechado`}>
          As compras ficam disponíveis para consulta, mas não podem ser incluídas nem alteradas.
        </Alert>
      ) : null}

      <div className="stats">
        <Stat label="Notas no mês" value={String(overview.purchaseCount)} />
        <Stat label="Total comprado" value={currency(overview.totalAmount)} />
        <Stat label="Para o estoque" value={currency(overview.inventoryAmount)} note="Vira custo quando for usado (CMV)" />
        <Stat label="Uso imediato e despesas" value={currency(overview.financialAmount)} note="Vai direto para o resultado" />
      </div>

      <Tabs
        active={tab}
        tabs={[
          { key: "registrar", label: purchase ? `Editando compra ${purchase.id}` : "Registrar compra", href: tabHref("/compras", selected, "registrar") },
          { key: "historico", label: "Compras do mês", count: purchases.length, href: tabHref("/compras", selected, "historico") },
          { key: "fornecedores", label: "Fornecedores", count: overview.activeSupplierCount, href: tabHref("/compras", selected, "fornecedores") },
          { key: "sinais", label: "Sinais de reposição", href: tabHref("/compras", selected, "sinais") },
        ]}
      />

      {tab === "registrar" ? (
        <Card
          title={purchase ? `Editar compra ${purchase.id} — ${purchase.supplier_name}` : "Nova compra"}
          description="Informe data, fornecedor e pagamento uma vez e depois os itens da nota."
          actions={
            purchase ? (
              <Link className="btn btn-sm" href={tabHref("/compras", selected, "historico")}>
                Cancelar edição
              </Link>
            ) : null
          }
        >
          {!activeSuppliers.length ? (
            <Alert tone="warning">Cadastre um fornecedor na aba Fornecedores antes de registrar a primeira compra.</Alert>
          ) : null}
          <PurchaseForm
            immediateItems={immediateItems.filter((item) => item.isActive)}
            key={purchase?.id || "nova"}
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
        </Card>
      ) : null}

      {tab === "historico" ? (
        <Card title={`Compras de ${selected.label.toLowerCase()}`} flush>
          <form action="/compras" className="filters">
            <PeriodHidden year={selected.year} month={selected.month} aba="historico" />
            <div className="field">
              <label htmlFor="f-supplier">Fornecedor</label>
              <select id="f-supplier" name="supplierId" defaultValue={filters.supplierId || ""}>
                <option value="">Todos</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-dest">Destino</label>
              <select id="f-dest" name="destination" defaultValue={filters.destination || ""}>
                <option value="">Todos</option>
                <option value="inventory">Estoque</option>
                <option value="financial">Uso imediato</option>
              </select>
            </div>
            <div className="field grow">
              <label htmlFor="f-q">Buscar</label>
              <input id="f-q" name="q" defaultValue={filters.q || ""} placeholder="Nota, item ou observação" />
            </div>
            <button className="btn" type="submit">Filtrar</button>
            {hasFilters ? (
              <Link className="btn btn-ghost" href={tabHref("/compras", selected, "historico")}>
                Limpar
              </Link>
            ) : null}
          </form>
          {purchases.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Fornecedor</th>
                    <th>Pagamento</th>
                    <th className="num">Itens</th>
                    <th className="num">Estoque</th>
                    <th className="num">Uso imediato</th>
                    <th className="num">Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDate(row.purchase_date)}</td>
                      <td>
                        <strong>{row.supplier_name}</strong>
                        {row.invoice_number ? <span className="sub">Nota {row.invoice_number}</span> : null}
                      </td>
                      <td>{row.payment_method_name}</td>
                      <td className="num">{row.line_count}</td>
                      <td className="num">{currency(row.inventory_amount)}</td>
                      <td className="num">{currency(row.financial_amount)}</td>
                      <td className="num"><strong>{currency(row.total_amount)}</strong></td>
                      <td>
                        {selected.isClosed ? (
                          <Badge>protegido</Badge>
                        ) : (
                          <div className="row-actions">
                            <Link className="btn btn-sm btn-ghost" href={tabHref("/compras", selected, "registrar", { editCompra: row.id })}>
                              Editar
                            </Link>
                            <form action={deletePurchaseAction}>
                              <input type="hidden" name="id" value={row.id} />
                              <PeriodHidden year={selected.year} month={selected.month} aba="historico" />
                              <ConfirmButton message="Excluir esta compra? As entradas de estoque e os lançamentos dela também serão removidos.">
                                Excluir
                              </ConfirmButton>
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
            <Empty>{hasFilters ? "Nenhuma compra com esses filtros." : "Nenhuma compra registrada neste mês."}</Empty>
          )}
        </Card>
      ) : null}

      {tab === "fornecedores" ? (
        <>
          <Drawer title={supplierToEdit ? `Editar ${supplierToEdit.name}` : "Novo fornecedor"} open={Boolean(supplierToEdit)}>
            <form action={saveSupplierAction} className="form" key={supplierToEdit?.id || "novo"}>
              <input type="hidden" name="id" value={supplierToEdit?.id || ""} />
              <PeriodHidden year={selected.year} month={selected.month} aba="fornecedores" />
              <div className="fields">
                <div className="field">
                  <label htmlFor="s-name">Nome</label>
                  <input id="s-name" name="name" defaultValue={supplierToEdit?.name || ""} required />
                </div>
                <div className="field">
                  <label htmlFor="s-contact">Contato (opcional)</label>
                  <input id="s-contact" name="contact" defaultValue={supplierToEdit?.contact || ""} />
                </div>
                <div className="field wide">
                  <label htmlFor="s-notes">Observação (opcional)</label>
                  <input id="s-notes" name="notes" defaultValue={supplierToEdit?.notes || ""} />
                </div>
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" type="submit">Salvar fornecedor</button>
                {supplierToEdit ? (
                  <Link className="btn btn-ghost" href={tabHref("/compras", selected, "fornecedores")}>Cancelar</Link>
                ) : null}
              </div>
            </form>
          </Drawer>

          <Card title="Fornecedores" description="Arquivar tira da lista de compras, mas mantém o histórico." flush>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fornecedor</th>
                    <th>Contato</th>
                    <th>Situação</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((supplier) => (
                    <tr key={supplier.id}>
                      <td><strong>{supplier.name}</strong>{supplier.notes ? <span className="sub">{supplier.notes}</span> : null}</td>
                      <td>{supplier.contact || "—"}</td>
                      <td>{supplier.is_active ? <Badge tone="success">ativo</Badge> : <Badge>arquivado</Badge>}</td>
                      <td>
                        <div className="row-actions">
                          <Link className="btn btn-sm btn-ghost" href={tabHref("/compras", selected, "fornecedores", { editFornecedor: supplier.id })}>
                            Editar
                          </Link>
                          <form action={supplier.is_active ? archiveSupplierAction : reactivateSupplierAction}>
                            <input type="hidden" name="id" value={supplier.id} />
                            <PeriodHidden year={selected.year} month={selected.month} aba="fornecedores" />
                            <button className="btn btn-sm btn-ghost" type="submit">{supplier.is_active ? "Arquivar" : "Reativar"}</button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}

      {tab === "sinais" ? (
        <Card
          title="Sinais de reposição"
          description="Produtos comprados várias vezes em intervalos curtos — candidatos a compra maior e menos idas ao mercado. Não é uma ordem de compra."
          flush
        >
          <div className="filters">
            <span className="muted">
              {analysis.latestCountDate
                ? `Última contagem considerada: ${formatDate(analysis.latestCountDate)}${analysis.isCurrentPeriodPartial ? " (mês ainda sem contagem final)" : ""}.`
                : "Ainda não há contagem de estoque neste mês; a média usa os meses anteriores."}
            </span>
          </div>
          {analysis.insights.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="num">Dias de compra no ano</th>
                    <th className="num">Recompras em até 7 dias</th>
                    <th className="num">Consumo médio/mês</th>
                    <th className="num">Saldo atual</th>
                    <th>Confiança</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.insights.map((insight) => (
                    <tr key={insight.itemId}>
                      <td>
                        <strong>{insight.itemName}</strong>
                        <span className="sub">
                          Preço pago: {currency(insight.minimumUnitPrice)} a {currency(insight.maximumUnitPrice)}
                        </span>
                      </td>
                      <td className="num">{insight.purchaseDays}</td>
                      <td className="num">{insight.closePurchaseIntervals}</td>
                      <td className="num">{quantity(insight.averageMonthlyUsage)}</td>
                      <td className="num">{quantity(insight.currentQuantity)}</td>
                      <td><Badge tone={CONFIDENCE[insight.confidence].tone}>{CONFIDENCE[insight.confidence].label}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Ainda não há histórico suficiente.</Empty>
          )}
        </Card>
      ) : null}
    </>
  );
}
