import Link from "next/link";
import {
  archiveProductAction,
  duplicateProductAction,
  reactivateProductAction,
  saveIndirectDefaultAction,
} from "@/app/actions";
import { Alert, Badge, Card, Empty, Flash, Icon, PageHead, Stat } from "@/components/ui";
import { getCostEditorData, getCostsOverview } from "@/lib/custos";
import type { SearchParams } from "@/lib/types";
import { currency, formatDate, percent } from "@/lib/utils";
import { paramText } from "../_comum";
import { RecipeEditor } from "./recipe-editor";

type PageProps = { searchParams?: Promise<SearchParams> };

export default async function CustosPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const produto = paramText(params, "produto");
  const flash = <Flash error={paramText(params, "error")} notice={paramText(params, "notice")} />;

  if (produto) {
    const data = await getCostEditorData(Number(produto) || 0);
    const product = data.product;
    return (
      <>
        <PageHead
          title={product ? product.name : "Novo produto"}
          description="Ficha técnica: o custo usa o último preço pago de cada item e se atualiza a cada compra. Não baixa estoque."
        >
          <Link className="btn btn-ghost" href="/custos">← Todos os produtos</Link>
        </PageHead>
        {flash}
        {produto !== "novo" && !product ? (
          <Alert tone="warning" title="Produto não encontrado">Volte para a lista e escolha outro.</Alert>
        ) : (
          <RecipeEditor
            key={product ? `${product.id}-${product.updatedAt}` : "novo"}
            product={product}
            book={data.book}
            indirectDefault={data.indirectDefault}
            itemOptions={data.itemOptions}
            immediateOptions={data.immediateOptions}
            categories={data.categories}
          />
        )}
        {product ? (
          <div className="form-actions" style={{ marginTop: 16 }}>
            <form action={duplicateProductAction}>
              <input type="hidden" name="id" value={product.id} />
              <button className="btn btn-sm" type="submit"><Icon name="copy" size={16} /> Duplicar (para outro tamanho ou sabor)</button>
            </form>
            <form action={product.isActive ? archiveProductAction : reactivateProductAction}>
              <input type="hidden" name="id" value={product.id} />
              <button className="btn btn-sm btn-ghost" type="submit">{product.isActive ? "Arquivar produto" : "Reativar produto"}</button>
            </form>
            <span className="muted">Última alteração: {formatDate(product.updatedAt.slice(0, 10))}</span>
          </div>
        ) : null}
      </>
    );
  }

  const { rows, indirectDefault } = await getCostsOverview();
  const active = rows.filter((row) => row.product.isActive);
  const archived = rows.filter((row) => !row.product.isActive);
  const priced = active.filter((row) => row.cost.margin !== null);
  const below = active.filter(
    (row) => row.cost.margin !== null && row.product.targetMargin !== null && row.cost.margin < row.product.targetMargin,
  );
  const withWarnings = active.filter((row) => row.cost.warnings > 0);
  const averageMargin = priced.length ? priced.reduce((sum, row) => sum + (row.cost.margin || 0), 0) / priced.length : null;

  return (
    <>
      <PageHead
        title="Custos dos produtos"
        description="Quanto custa cada produto hoje, pelo último preço pago de cada ingrediente e material, e qual a margem."
      >
        <Link className="btn btn-primary" href="/custos?produto=novo"><Icon name="plus" size={16} /> Novo produto</Link>
      </PageHead>
      {flash}

      <div className="stats">
        <Stat label="Produtos com ficha" value={String(active.length)} note={archived.length ? `${archived.length} arquivados` : undefined} />
        <Stat label="Margem média" value={averageMargin === null ? "—" : percent(averageMargin)} note={`${priced.length} com preço de venda`} />
        <Stat label="Abaixo da margem desejada" value={String(below.length)} tone={below.length ? "neg" : undefined} />
        <Stat label="Custos indiretos padrão" value={percent(indirectDefault)} note="água, luz, gás…" />
      </div>

      {below.length ? (
        <Alert tone="warning" title="Margem abaixo do desejado">
          {below.map((row) => row.product.name).join(", ")}: o custo subiu ou o preço está baixo. Abra a ficha para ver o preço sugerido.
        </Alert>
      ) : null}
      {withWarnings.length ? (
        <Alert tone="info" title="Fichas com avisos">
          {withWarnings.map((row) => row.product.name).join(", ")} têm item sem compra registrada ou com unidade que não combina.
        </Alert>
      ) : null}

      <Card title="Produtos" description="Clique no produto para abrir a ficha técnica." flush>
        {active.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="num">Rende</th>
                  <th className="num">Custo da receita</th>
                  <th className="num">Custo por unidade</th>
                  <th className="num">Preço de venda</th>
                  <th className="num">Margem</th>
                  <th className="num">Preço sugerido</th>
                </tr>
              </thead>
              <tbody>
                {active.map(({ product, cost }) => {
                  const low = cost.margin !== null && product.targetMargin !== null && cost.margin < product.targetMargin;
                  return (
                    <tr key={product.id}>
                      <td>
                        <Link href={`/custos?produto=${product.id}`}><strong>{product.name}</strong></Link>
                        <span className="sub">
                          {product.category ? `${product.category} · ` : ""}
                          {product.lines.length} {product.lines.length === 1 ? "item" : "itens"}
                          {cost.warnings ? ` · ${cost.warnings} aviso(s)` : ""}
                        </span>
                      </td>
                      <td className="num">{new Intl.NumberFormat("pt-BR").format(product.yieldQty)} {product.yieldUnit}</td>
                      <td className="num">{currency(cost.total)}</td>
                      <td className="num"><strong>{currency(cost.perUnit)}</strong></td>
                      <td className="num">{product.salePrice !== null ? currency(product.salePrice) : "—"}</td>
                      <td className="num">
                        {cost.margin === null ? "—" : low ? <Badge tone="danger">{percent(cost.margin)}</Badge> : percent(cost.margin)}
                        {product.targetMargin !== null ? <span className="sub">alvo {percent(product.targetMargin)}</span> : null}
                      </td>
                      <td className="num">{cost.suggestedPrice !== null ? currency(cost.suggestedPrice) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            Nenhum produto ainda. Comece por <Link href="/custos?produto=novo">Novo produto</Link>: por exemplo, Bem-casado,
            com uma receita que rende 25 unidades.
          </Empty>
        )}
        {archived.length ? (
          <p className="muted" style={{ padding: "12px 20px", margin: 0 }}>
            Arquivados:{" "}
            {archived.map(({ product }, index) => (
              <span key={product.id}>
                {index ? ", " : ""}
                <Link href={`/custos?produto=${product.id}`}>{product.name}</Link>
              </span>
            ))}
          </p>
        ) : null}
      </Card>

      <Card
        title="Custos indiretos"
        description="Água, luz, gás e desgaste de equipamentos não aparecem nas notas de cada receita. Este percentual é somado ao custo dos ingredientes de todos os produtos (cada ficha pode usar um próprio)."
      >
        <form action={saveIndirectDefaultAction} className="inline-form" style={{ maxWidth: 420 }}>
          <div className="field">
            <label htmlFor="indirect-default">Percentual padrão (%)</label>
            <input
              id="indirect-default"
              name="indirectPct"
              type="number"
              min="0"
              max="500"
              step="0.1"
              inputMode="decimal"
              defaultValue={Math.round(indirectDefault * 1000) / 10}
              required
            />
          </div>
          <button className="btn" type="submit" style={{ alignSelf: "flex-end" }}>Salvar</button>
        </form>
        <p className="muted" style={{ marginTop: 10 }}>
          Para estimar: some as contas de água, luz e gás de um mês, estime quanto delas é da confeitaria e divida pelo gasto
          com ingredientes e materiais do mesmo mês.
        </p>
      </Card>
    </>
  );
}
