import Link from "next/link";
import { FormCard } from "@/components/form-card";
import { PageIntro } from "@/components/page-intro";
import { Pill } from "@/components/pill";
import { TableCard } from "@/components/table-card";
import { deleteItemAction, reactivateItemAction, saveItemAction } from "@/app/actions";
import { getEditBundle, getItemCategories, getItemMetrics, getItems, getPeriodContext } from "@/lib/data";
import type { SearchParams } from "@/lib/types";
import { buildPeriodHref, currency, quantity } from "@/lib/utils";

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

export default async function EstoquePage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const showArchived = `${params.showArchived || ""}` === "1";

  const [{ selected, options }, categories, items, archivedItems, itemMetrics, editBundle] = await Promise.all([
    getPeriodContext(params),
    getItemCategories(),
    getItems(),
    getItems({ status: "archived" }),
    getItemMetrics(params),
    getEditBundle(params),
  ]);

  const editing = editBundle.item;
  const lowStockCount = itemMetrics.filter(
    (item) => item.isActive && item.finalQty <= item.lowStockThreshold && item.lowStockThreshold > 0,
  ).length;
  const stockValue = itemMetrics.reduce((sum, item) => sum + item.finalValue, 0);

  return (
    <div className="grid">
      <PageIntro
        title="Estoque"
        description="Cadastre itens, acompanhe saldo inicial, entradas, saídas, custo médio, CMV e valor final em estoque."
        options={options}
        selectedKey={`${selected.year}-${String(selected.month).padStart(2, "0")}`}
      />

      <div className="split">
        <FormCard
          title={editing ? "Editar item" : "Novo item de estoque"}
          subtitle="Itens são a base para entradas, saídas e cálculo do custo médio."
        >
          <form action={saveItemAction} className="grid">
            <input type="hidden" name="id" value={editing?.id || ""} />
            <input type="hidden" name="year" value={selected.year} />
            <input type="hidden" name="month" value={selected.month} />

            <div className="form-grid">
              <div className="field">
                <label htmlFor="name">Item</label>
                <input id="name" name="name" defaultValue={editing?.name || ""} required />
              </div>
              <div className="field">
                <label htmlFor="categoryName">Categoria</label>
                <input
                  id="categoryName"
                  name="categoryName"
                  list="item-categories"
                  defaultValue={editing?.category_name || "Ingrediente"}
                  required
                />
                <datalist id="item-categories">
                  {categories.map((category) => (
                    <option key={category.id} value={category.name} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label htmlFor="unitSize">Tamanho da unidade</label>
                <input
                  id="unitSize"
                  name="unitSize"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing?.unit_size || ""}
                />
              </div>
              <div className="field">
                <label htmlFor="referencePrice">Preço de referência</label>
                <input
                  id="referencePrice"
                  name="referencePrice"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing?.reference_price || ""}
                />
              </div>
              <div className="field">
                <label htmlFor="pricePerKg">Preço por kg/litro</label>
                <input
                  id="pricePerKg"
                  name="pricePerKg"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing?.price_per_kg || ""}
                />
              </div>
              <div className="field">
                <label htmlFor="lowStockThreshold">Estoque mínimo</label>
                <input
                  id="lowStockThreshold"
                  name="lowStockThreshold"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing?.low_stock_threshold || 0}
                  required
                />
              </div>
              <div className="field full">
                <label htmlFor="notes">Observação</label>
                <textarea id="notes" name="notes" defaultValue={editing?.notes || ""} />
              </div>
            </div>

            <div className="form-actions">
              <button className="button" type="submit">
                {editing ? "Salvar alterações" : "Cadastrar item"}
              </button>
              {editing ? (
                <Link className="secondary-button" href={buildPeriodHref("/estoque", selected.year, selected.month)}>
                  Cancelar edição
                </Link>
              ) : null}
            </div>
          </form>
        </FormCard>

        <div className="grid">
          <div className="panel">
            <div className="page-header">
              <div>
                <h2>Resumo rápido</h2>
                <p>Quantidade total de itens ativos, alertas de estoque e consulta de itens arquivados.</p>
              </div>
              <Link
                className="secondary-button"
                href={buildPeriodHref("/estoque", selected.year, selected.month, {
                  showArchived: showArchived ? undefined : 1,
                })}
              >
                {showArchived ? "Ocultar arquivados" : `Ver arquivados (${archivedItems.length})`}
              </Link>
            </div>
            <div className="pill-row">
              <Pill>{items.length} itens ativos</Pill>
              <Pill tone="warning">{lowStockCount} com estoque baixo</Pill>
              <Pill tone="success">{currency(stockValue)} em estoque</Pill>
              <Pill tone="danger">{archivedItems.length} arquivados</Pill>
            </div>
          </div>

          <div className="panel">
            <div className="page-header">
              <div>
                <h2>Decisão de produto</h2>
                <p>
                  O cadastro já separa ingredientes de embalagens, mantém limite mínimo por item
                  e agora também oferece uma área específica para consulta e reativação dos arquivados.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <TableCard
        title="Relatório de estoque"
        subtitle="Saldo inicial, entradas, saídas, custo médio, CMV e saldo final por item."
      >
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Categoria</th>
              <th className="numeric">Inicial</th>
              <th className="numeric">Entradas</th>
              <th className="numeric">Saídas</th>
              <th className="numeric">Saldo final</th>
              <th className="numeric">Preço médio</th>
              <th className="numeric">CMV</th>
              <th className="numeric">Valor final</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {itemMetrics.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.name}</strong>
                  {!item.isActive ? (
                    <div style={{ marginTop: 6 }}>
                      <Pill tone="danger">arquivado</Pill>
                    </div>
                  ) : null}
                  {item.lowStockThreshold > 0 && item.finalQty <= item.lowStockThreshold ? (
                    <div style={{ marginTop: 6 }}>
                      <Pill tone={item.finalQty <= 0 ? "danger" : "warning"}>abaixo do mínimo</Pill>
                    </div>
                  ) : null}
                </td>
                <td>{item.categoryName}</td>
                <td className="numeric">{quantity(item.openingQty)}</td>
                <td className="numeric">{quantity(item.entriesQty)}</td>
                <td className="numeric">{quantity(item.usageQty)}</td>
                <td className="numeric">{quantity(item.finalQty)}</td>
                <td className="numeric">{currency(item.averageCost)}</td>
                <td className="numeric">{currency(item.cmv)}</td>
                <td className="numeric">{currency(item.finalValue)}</td>
                <td>
                  <div className="inline-actions">
                    <Link
                      className="ghost-link"
                      href={buildPeriodHref("/estoque", selected.year, selected.month, {
                        editItem: item.id,
                        showArchived: showArchived ? 1 : undefined,
                      })}
                    >
                      Editar
                    </Link>
                    <form action={deleteItemAction}>
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="year" value={selected.year} />
                      <input type="hidden" name="month" value={selected.month} />
                      <button className="danger-button" type="submit">
                        Arquivar
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      {showArchived ? (
        <TableCard
          title="Itens arquivados"
          subtitle={
            archivedItems.length
              ? "Itens fora da operação diária, mas ainda disponíveis para consulta e reativação."
              : "Nenhum item arquivado neste momento."
          }
        >
          {archivedItems.length ? (
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Categoria</th>
                  <th>Observação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {archivedItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                    </td>
                    <td>{item.category_name || "Sem categoria"}</td>
                    <td>{item.notes || "Sem observação"}</td>
                    <td>
                      <div className="inline-actions">
                        <Link
                          className="ghost-link"
                          href={buildPeriodHref("/estoque", selected.year, selected.month, {
                            editItem: item.id,
                            showArchived: 1,
                          })}
                        >
                          Editar
                        </Link>
                        <form action={reactivateItemAction}>
                          <input type="hidden" name="id" value={item.id} />
                          <input type="hidden" name="year" value={selected.year} />
                          <input type="hidden" name="month" value={selected.month} />
                          <button className="secondary-button" type="submit">
                            Reativar
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">Quando você arquivar um item, ele aparecerá aqui para consulta e reativação.</div>
          )}
        </TableCard>
      ) : null}
    </div>
  );
}
