import Link from "next/link";
import {
  deleteInventoryEntryAction,
  deleteInventoryUsageAction,
  deleteItemAction,
  reactivateItemAction,
  saveInventoryEntryAction,
  saveInventoryUsageAction,
  saveItemAction,
} from "@/app/actions";
import { ConfirmButton, ItemPicker } from "@/components/client-ui";
import { Alert, Badge, Card, Drawer, Empty, Flash, PageHead, PeriodHidden, Stat, Tabs } from "@/components/ui";
import {
  getEditBundle,
  getInventoryEntries,
  getInventoryUsages,
  getItemCategories,
  getItemMetrics,
  getItems,
  getPaymentMethods,
  getPeriodContext,
} from "@/lib/data";
import type { SearchParams } from "@/lib/types";
import { currency, formatDate, isoToday, quantity } from "@/lib/utils";
import { PeriodPicker, paramText, tabHref } from "../_comum";

type PageProps = { searchParams?: Promise<SearchParams> };

const TABS = ["posicao", "contagem", "entradas", "itens"] as const;

function lastDayOfMonth(year: number, month: number) {
  const today = isoToday();
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  if (today.startsWith(prefix)) return today;
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${prefix}-${String(day).padStart(2, "0")}`;
}

function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export default async function EstoquePage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const requested = paramText(params, "aba");
  const tab = params.editSaida ? "contagem" : params.editEntrada ? "entradas" : params.editItem ? "itens" : (TABS as readonly string[]).includes(requested) ? requested : "posicao";
  const [{ selected, options }, categories, items, archivedItems, metrics, usages, entries, paymentMethods, edit] = await Promise.all([
    getPeriodContext(params),
    getItemCategories(),
    getItems(),
    getItems({ status: "archived" }),
    getItemMetrics(params),
    getInventoryUsages(params),
    getInventoryEntries(params),
    getPaymentMethods(),
    getEditBundle(params),
  ]);

  const search = paramText(params, "q");
  const category = paramText(params, "categoria");
  const showAll = paramText(params, "todos") === "1";
  const withMovement = metrics.filter(
    (item) => item.openingQty !== 0 || item.entriesQty !== 0 || item.usageQty !== 0 || item.finalQty !== 0,
  );
  const positionRows = (showAll ? metrics.filter((item) => item.isActive || item.finalQty !== 0) : withMovement)
    .filter((item) => !search || normalize(item.name).includes(normalize(search)))
    .filter((item) => !category || item.categoryName === category)
    .sort((a, b) => b.finalValue - a.finalValue || a.name.localeCompare(b.name, "pt-BR"));
  const stockValue = metrics.reduce((sum, item) => sum + item.finalValue, 0);
  const cmv = metrics.reduce((sum, item) => sum + item.cmv, 0);
  const entriesValue = metrics.reduce((sum, item) => sum + item.entriesValue, 0);
  const itemOptions = items.map((item) => ({ id: item.id, name: item.name, group: item.category_name }));
  const locked = selected.isClosed;
  const usage = edit.inventoryUsage;
  const entry = edit.inventoryEntry;
  const editItem = edit.item;

  return (
    <>
      <PageHead title="Estoque" description="Saldo, custo médio e consumo de cada ingrediente e embalagem.">
        <PeriodPicker options={options} selected={selected} />
      </PageHead>

      <Flash error={paramText(params, "error")} notice={paramText(params, "notice")} />
      {locked ? (
        <Alert tone="info" title={`${selected.label} está fechado`}>
          Os dados ficam para consulta. Para corrigir algo, reabra o mês no Financeiro.
        </Alert>
      ) : null}

      <div className="stats">
        <Stat label="Valor em estoque" value={currency(stockValue)} note="No fim do mês, a custo médio" />
        <Stat label="Entradas no mês" value={currency(entriesValue)} note="Compras para o estoque" />
        <Stat label="CMV do mês" value={currency(cmv)} note={usages.length ? `${usages.length} baixas lançadas` : "Sem contagem neste mês"} />
        <Stat label="Itens ativos" value={String(items.length)} note={`${archivedItems.length} arquivados`} />
      </div>

      <Tabs
        active={tab}
        tabs={[
          { key: "posicao", label: "Posição", href: tabHref("/estoque", selected, "posicao") },
          { key: "contagem", label: "Contagem e baixas", count: usages.length, href: tabHref("/estoque", selected, "contagem") },
          { key: "entradas", label: "Entradas", count: entries.length, href: tabHref("/estoque", selected, "entradas") },
          { key: "itens", label: "Itens", count: items.length, href: tabHref("/estoque", selected, "itens") },
        ]}
      />

      {tab === "posicao" ? (
        <Card flush>
          <form action="/estoque" className="filters">
            <PeriodHidden year={selected.year} month={selected.month} aba="posicao" />
            <div className="field grow">
              <label htmlFor="p-q">Buscar item</label>
              <input id="p-q" name="q" defaultValue={search} placeholder="Ex.: chocolate" />
            </div>
            <div className="field">
              <label htmlFor="p-cat">Categoria</label>
              <select id="p-cat" name="categoria" defaultValue={category}>
                <option value="">Todas</option>
                {categories.map((item) => (
                  <option key={item.id} value={item.name}>{item.name}</option>
                ))}
              </select>
            </div>
            <label className="check" style={{ alignSelf: "center" }}>
              <input type="checkbox" name="todos" value="1" defaultChecked={showAll} />
              Incluir itens sem movimento
            </label>
            <button className="btn" type="submit">Filtrar</button>
          </form>
          {positionRows.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Início do mês</th>
                    <th className="num">Entradas</th>
                    <th className="num">Baixas</th>
                    <th className="num">Saldo</th>
                    <th className="num">Custo médio</th>
                    <th className="num">CMV</th>
                    <th className="num">Valor em estoque</th>
                  </tr>
                </thead>
                <tbody>
                  {positionRows.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>{" "}
                        {item.lowStockThreshold > 0 && item.isActive && item.finalQty <= item.lowStockThreshold ? (
                          <Badge tone={item.finalQty <= 0 ? "danger" : "warning"}>{item.finalQty <= 0 ? "zerado" : "baixo"}</Badge>
                        ) : null}
                        <span className="sub">{item.categoryName}</span>
                      </td>
                      <td className="num">{quantity(item.openingQty)}</td>
                      <td className="num">{item.entriesQty ? `+${quantity(item.entriesQty)}` : "—"}</td>
                      <td className="num">{item.usageQty ? `−${quantity(item.usageQty)}` : "—"}</td>
                      <td className="num"><strong>{quantity(item.finalQty)}</strong></td>
                      <td className="num">{currency(item.averageCost)}</td>
                      <td className="num">{currency(item.cmv)}</td>
                      <td className="num">{currency(item.finalValue)}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>Total ({positionRows.length} itens)</td>
                    <td colSpan={5} />
                    <td className="num">{currency(positionRows.reduce((sum, item) => sum + item.cmv, 0))}</td>
                    <td className="num">{currency(positionRows.reduce((sum, item) => sum + item.finalValue, 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Nenhum item encontrado.</Empty>
          )}
        </Card>
      ) : null}

      {tab === "contagem" ? (
        <>
          {!locked ? (
            <Drawer
              title={usage ? `Editar baixa de ${usage.item_name}` : "Nova baixa de estoque"}
              hint="consumo apurado na contagem física"
              open={Boolean(usage) || usages.length === 0}
            >
              <form action={saveInventoryUsageAction} className="form" key={usage?.id || "nova"}>
                <input type="hidden" name="id" value={usage?.id || ""} />
                <PeriodHidden year={selected.year} month={selected.month} aba="contagem" />
                <div className="fields">
                  <div className="field">
                    <label htmlFor="u-date">Data da contagem</label>
                    <input id="u-date" type="date" name="date" defaultValue={usage?.movement_date || lastDayOfMonth(selected.year, selected.month)} required />
                  </div>
                  <div className="field" style={{ gridColumn: "span 2" }}>
                    <label htmlFor="u-item">Item</label>
                    <ItemPicker id="u-item" name="itemId" options={itemOptions} defaultId={usage?.item_id} placeholder="Buscar item…" required />
                  </div>
                  <div className="field">
                    <label htmlFor="u-qty">Quantidade consumida</label>
                    <input id="u-qty" type="number" step="0.01" min="0.01" inputMode="decimal" name="quantity" defaultValue={usage?.quantity ?? ""} required />
                    <span className="hint">Saldo anterior menos o que sobrou na contagem.</span>
                  </div>
                  <div className="field wide">
                    <label htmlFor="u-notes">Observação (opcional)</label>
                    <input id="u-notes" name="notes" defaultValue={usage?.notes || ""} />
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn btn-primary" type="submit">{usage ? "Salvar baixa" : "Registrar baixa"}</button>
                  {usage ? <Link className="btn btn-ghost" href={tabHref("/estoque", selected, "contagem")}>Cancelar</Link> : null}
                </div>
              </form>
            </Drawer>
          ) : null}

          <Card title="Baixas do mês" description="Cada baixa gera custo (CMV) pelo custo médio do item." flush>
            {usages.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Item</th>
                      <th className="num">Quantidade</th>
                      <th>Observação</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {usages.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDate(row.movement_date)}</td>
                        <td><strong>{row.item_name}</strong></td>
                        <td className="num">{quantity(row.quantity)}</td>
                        <td className="muted">{row.notes || ""}</td>
                        <td>
                          {locked ? null : (
                            <div className="row-actions">
                              <Link className="btn btn-sm btn-ghost" href={tabHref("/estoque", selected, "contagem", { editSaida: row.id })}>Editar</Link>
                              <form action={deleteInventoryUsageAction}>
                                <input type="hidden" name="id" value={row.id} />
                                <PeriodHidden year={selected.year} month={selected.month} aba="contagem" />
                                <ConfirmButton message={`Excluir a baixa de ${row.item_name}?`}>Excluir</ConfirmButton>
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
              <Empty>Nenhuma baixa neste mês. Depois da contagem física, lance aqui o consumo de cada item.</Empty>
            )}
          </Card>
        </>
      ) : null}

      {tab === "entradas" ? (
        <>
          <Alert
            tone="info"
            action={<Link className="btn btn-sm" href={tabHref("/compras", selected, "registrar")}>Registrar compra</Link>}
          >
            As entradas de estoque são feitas pela aba Compras, junto com a nota. Aqui ficam para conferência.
          </Alert>
          {entry && !locked ? (
            <Card title={`Editar entrada antiga — ${entry.item_name}`} description="Lançamento feito antes da aba Compras.">
              <form action={saveInventoryEntryAction} className="form" key={entry.id}>
                <input type="hidden" name="id" value={entry.id} />
                <PeriodHidden year={selected.year} month={selected.month} aba="entradas" />
                <div className="fields">
                  <div className="field">
                    <label htmlFor="e-date">Data</label>
                    <input id="e-date" type="date" name="date" defaultValue={entry.movement_date} required />
                  </div>
                  <div className="field">
                    <label htmlFor="e-pay">Pagamento</label>
                    <select id="e-pay" name="paymentMethodId" defaultValue={String(entry.payment_method_id)}>
                      {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="e-item">Item</label>
                    <ItemPicker id="e-item" name="itemId" options={itemOptions} defaultId={entry.item_id} required />
                  </div>
                  <div className="field">
                    <label htmlFor="e-qty">Quantidade</label>
                    <input id="e-qty" type="number" step="0.01" min="0.01" name="quantity" defaultValue={entry.quantity} required />
                  </div>
                  <div className="field">
                    <label htmlFor="e-total">Valor total</label>
                    <input id="e-total" type="number" step="0.01" min="0.01" name="totalAmount" defaultValue={entry.total_amount} required />
                  </div>
                  <div className="field wide">
                    <label htmlFor="e-notes">Observação</label>
                    <input id="e-notes" name="notes" defaultValue={entry.notes || ""} />
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn btn-primary" type="submit">Salvar entrada</button>
                  <Link className="btn btn-ghost" href={tabHref("/estoque", selected, "entradas")}>Cancelar</Link>
                </div>
              </form>
            </Card>
          ) : null}
          <Card title="Entradas do mês" flush>
            {entries.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Item</th>
                      <th>Fornecedor</th>
                      <th>Pagamento</th>
                      <th className="num">Quantidade</th>
                      <th className="num">Valor</th>
                      <th className="num">Por unidade</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDate(row.movement_date)}</td>
                        <td><strong>{row.item_name}</strong></td>
                        <td>
                          {row.supplier_name || <span className="muted">—</span>}
                          {row.invoice_number ? <span className="sub">Nota {row.invoice_number}</span> : null}
                        </td>
                        <td>{row.payment_method_name}</td>
                        <td className="num">{quantity(row.quantity)}</td>
                        <td className="num">{currency(row.total_amount)}</td>
                        <td className="num">{row.quantity ? currency(row.total_amount / row.quantity) : "—"}</td>
                        <td>
                          <div className="row-actions">
                            {row.purchase_id ? (
                              <Link className="btn btn-sm btn-ghost" href={tabHref("/compras", selected, "registrar", { editCompra: row.purchase_id })}>
                                Ver compra
                              </Link>
                            ) : locked ? null : (
                              <>
                                <Link className="btn btn-sm btn-ghost" href={tabHref("/estoque", selected, "entradas", { editEntrada: row.id })}>Editar</Link>
                                <form action={deleteInventoryEntryAction}>
                                  <input type="hidden" name="id" value={row.id} />
                                  <PeriodHidden year={selected.year} month={selected.month} aba="entradas" />
                                  <ConfirmButton message={`Excluir a entrada de ${row.item_name}?`}>Excluir</ConfirmButton>
                                </form>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Nenhuma entrada neste mês.</Empty>
            )}
          </Card>
        </>
      ) : null}

      {tab === "itens" ? (
        <>
          <Drawer title={editItem ? `Editar ${editItem.name}` : "Novo item"} open={Boolean(editItem)}>
            <form action={saveItemAction} className="form" key={editItem?.id || "novo"}>
              <input type="hidden" name="id" value={editItem?.id || ""} />
              <PeriodHidden year={selected.year} month={selected.month} aba="itens" />
              <div className="fields">
                <div className="field" style={{ gridColumn: "span 2" }}>
                  <label htmlFor="i-name">Nome (com a embalagem, ex.: Leite condensado - 395g)</label>
                  <input id="i-name" name="name" defaultValue={editItem?.name || ""} required />
                </div>
                <div className="field">
                  <label htmlFor="i-cat">Categoria</label>
                  <input id="i-cat" name="categoryName" list="categorias" defaultValue={editItem?.category_name || "Ingrediente"} required />
                  <datalist id="categorias">
                    {categories.map((item) => <option key={item.id} value={item.name} />)}
                  </datalist>
                </div>
                <div className="field">
                  <label htmlFor="i-min">Estoque mínimo</label>
                  <input id="i-min" name="lowStockThreshold" type="number" step="0.01" min="0" defaultValue={editItem?.low_stock_threshold ?? 0} required />
                </div>
                <div className="field">
                  <label htmlFor="i-size">Tamanho da unidade (opcional)</label>
                  <input id="i-size" name="unitSize" type="number" step="0.01" min="0" defaultValue={editItem?.unit_size ?? ""} />
                </div>
                <div className="field">
                  <label htmlFor="i-ref">Preço de referência (opcional)</label>
                  <input id="i-ref" name="referencePrice" type="number" step="0.01" min="0" defaultValue={editItem?.reference_price ?? ""} />
                </div>
                <div className="field">
                  <label htmlFor="i-kg">Preço por kg/L (opcional)</label>
                  <input id="i-kg" name="pricePerKg" type="number" step="0.01" min="0" defaultValue={editItem?.price_per_kg ?? ""} />
                </div>
                <div className="field wide">
                  <label htmlFor="i-notes">Observação (opcional)</label>
                  <input id="i-notes" name="notes" defaultValue={editItem?.notes || ""} />
                </div>
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" type="submit">{editItem ? "Salvar item" : "Cadastrar item"}</button>
                {editItem ? <Link className="btn btn-ghost" href={tabHref("/estoque", selected, "itens")}>Cancelar</Link> : null}
              </div>
            </form>
          </Drawer>

          <Card title="Itens ativos" description="Arquivar tira o item das listas do dia a dia, sem apagar o histórico." flush>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Categoria</th>
                    <th className="num">Mínimo</th>
                    <th className="num">Saldo atual</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const metric = metrics.find((row) => row.id === item.id);
                    return (
                      <tr key={item.id}>
                        <td><strong>{item.name}</strong>{item.notes ? <span className="sub">{item.notes}</span> : null}</td>
                        <td>{item.category_name || "—"}</td>
                        <td className="num">{item.low_stock_threshold ? quantity(item.low_stock_threshold) : "—"}</td>
                        <td className="num">{quantity(metric?.finalQty || 0)}</td>
                        <td>
                          <div className="row-actions">
                            <Link className="btn btn-sm btn-ghost" href={tabHref("/estoque", selected, "itens", { editItem: item.id })}>Editar</Link>
                            <form action={deleteItemAction}>
                              <input type="hidden" name="id" value={item.id} />
                              <PeriodHidden year={selected.year} month={selected.month} aba="itens" />
                              <ConfirmButton message={`Arquivar ${item.name}? O histórico continua preservado.`}>Arquivar</ConfirmButton>
                            </form>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {archivedItems.length ? (
            <Card title="Arquivados" description="Fora do uso diário, disponíveis para consulta e reativação." flush>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {archivedItems.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{item.name}</strong><span className="sub">{item.category_name || "Sem categoria"}</span></td>
                        <td>
                          <div className="row-actions">
                            <form action={reactivateItemAction}>
                              <input type="hidden" name="id" value={item.id} />
                              <PeriodHidden year={selected.year} month={selected.month} aba="itens" />
                              <button className="btn btn-sm btn-ghost" type="submit">Reativar</button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}
