"use client";

import { useMemo, useState } from "react";
import { saveProductAction } from "@/app/actions";
import { ItemPicker, type PickerOption } from "@/components/client-ui";
import { Icon } from "@/components/ui";
import {
  hoursText,
  LINE_UNITS,
  priceKey,
  productCost,
  stageSummary,
  type CostLine,
  type LineKind,
  type LineUnit,
  type PriceInfo,
} from "@/lib/custos-calc";
import type { ProductRecord } from "@/lib/custos";

type EditorLine = {
  key: string;
  kind: LineKind;
  itemId: string;
  immediateItemId: string;
  description: string;
  quantity: string;
  unit: LineUnit;
  perUnit: boolean;
  manualCost: string;
};

type EditorStage = { key: string; name: string; day: string; hours: string; mins: string; fixed: boolean };

const splitMinutes = (total: number) => ({ hours: String(Math.floor(total / 60) || ""), mins: String(Math.round(total % 60) || "") });

let nextKey = 1;
const newKey = () => `l${nextKey++}`;

function blankLine(kind: LineKind): EditorLine {
  return {
    key: newKey(),
    kind,
    itemId: "",
    immediateItemId: "",
    description: "",
    quantity: "",
    unit: kind === "item" ? "g" : "emb",
    perUnit: false,
    manualCost: "",
  };
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
function pct(value: number) {
  return `${(value * 100).toFixed(1).replace(".", ",")}%`;
}
function qtyText(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
}
function dateText(value: string | null) {
  if (!value) return "";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}
const toNumber = (value: string) => (value.trim() === "" ? null : Number(value.replace(",", ".")));

const CONTENT_LABEL = { g: "g", ml: "ml", un: "un" } as const;

function priceText(info: PriceInfo | undefined, kind: LineKind) {
  if (!info) return "";
  if (info.price == null) return "";
  const content =
    kind === "item"
      ? info.contentUnit === "un" && info.contentQty === 1
        ? "a unidade/embalagem"
        : `a embalagem de ${qtyText(info.contentQty)} ${CONTENT_LABEL[info.contentUnit]}${info.contentSource === "nome" ? " (lido do nome)" : ""}`
      : info.perPurchase
        ? "a última compra"
        : "a unidade de compra";
  const when = info.date ? ` · ${dateText(info.date)}${info.supplier ? `, ${info.supplier}` : ""}` : info.supplier ? ` · ${info.supplier}` : "";
  return `${money(info.price)} ${content}${when}`;
}

export function RecipeEditor({
  product,
  book,
  indirectDefault,
  itemOptions,
  immediateOptions,
  categories,
}: {
  product: ProductRecord | null;
  book: Record<string, PriceInfo>;
  indirectDefault: number;
  itemOptions: PickerOption[];
  immediateOptions: PickerOption[];
  categories: string[];
}) {
  const [name, setName] = useState(product?.name || "");
  const [category, setCategory] = useState(product?.category || "");
  const [yieldQty, setYieldQty] = useState(product ? String(product.yieldQty) : "");
  const [yieldUnit, setYieldUnit] = useState(product?.yieldUnit || "unidades");
  const [salePrice, setSalePrice] = useState(product?.salePrice != null ? String(product.salePrice) : "");
  const [targetMargin, setTargetMargin] = useState(product?.targetMargin != null ? String(Math.round(product.targetMargin * 1000) / 10) : "");
  const [indirect, setIndirect] = useState(product?.indirectPct != null ? String(Math.round(product.indirectPct * 1000) / 10) : "");
  const [stages, setStages] = useState<EditorStage[]>(() =>
    product?.stages.length
      ? product.stages.map((stage) => ({
          key: newKey(),
          name: stage.name,
          day: String(stage.day),
          ...splitMinutes(stage.minutes),
          fixed: stage.fixed,
        }))
      : product?.prepMinutes
        ? [{ key: newKey(), name: "Produção", day: "1", ...splitMinutes(product.prepMinutes), fixed: false }]
        : [],
  );
  const [notes, setNotes] = useState(product?.notes || "");
  const [lines, setLines] = useState<EditorLine[]>(() =>
    product?.lines.length
      ? product.lines.map((line) => ({
          key: newKey(),
          kind: line.kind,
          itemId: line.itemId ? String(line.itemId) : "",
          immediateItemId: line.immediateItemId ? String(line.immediateItemId) : "",
          description: line.description || "",
          quantity: line.kind === "manual" ? "" : String(line.quantity),
          unit: line.unit,
          perUnit: line.perUnit,
          manualCost: line.manualCost != null ? String(line.manualCost) : "",
        }))
      : [blankLine("item")],
  );

  const yieldNumber = Number(toNumber(yieldQty)) || 0;
  const indirectPct = indirect.trim() === "" ? indirectDefault : (Number(toNumber(indirect)) || 0) / 100;
  const marginTarget = targetMargin.trim() === "" ? null : (Number(toNumber(targetMargin)) || 0) / 100;
  const sale = toNumber(salePrice);

  const costLines: CostLine[] = lines.map((line) => ({
    kind: line.kind,
    itemId: Number(line.itemId) || null,
    immediateItemId: Number(line.immediateItemId) || null,
    description: line.description,
    quantity: Number(toNumber(line.quantity)) || 0,
    unit: line.unit,
    perUnit: line.perUnit,
    manualCost: toNumber(line.manualCost),
  }));
  const filled = costLines.filter(
    (line) => (line.kind === "item" && line.itemId) || (line.kind === "immediate" && line.immediateItemId) || (line.kind === "manual" && line.description?.trim()),
  );
  const cost = productCost(
    { yieldQty: yieldNumber || 1, salePrice: sale, targetMargin: marginTarget, indirectPct },
    costLines,
    (line) => book[priceKey(line)],
  );

  const groupOf = useMemo(() => new Map(itemOptions.map((option) => [option.id, option.group || "Outros"])), [itemOptions]);
  const composition = new Map<string, number>();
  costLines.forEach((line, index) => {
    const group =
      line.kind === "item" ? groupOf.get(line.itemId || 0) || "Outros" : line.kind === "immediate" ? "Uso imediato" : "Outros custos";
    composition.set(group, (composition.get(group) || 0) + cost.lines[index].cost);
  });
  const ranking = costLines
    .map((line, index) => ({
      name:
        line.kind === "item"
          ? itemOptions.find((option) => option.id === line.itemId)?.name
          : line.kind === "immediate"
            ? immediateOptions.find((option) => option.id === line.immediateItemId)?.name
            : line.description,
      cost: cost.lines[index].cost,
    }))
    .filter((row) => row.name && row.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3);

  const stageRows = stages
    .map((stage) => ({
      name: stage.name.trim(),
      day: Math.min(Math.max(Math.round(Number(stage.day) || 1), 1), 60),
      minutes: Math.round((Number(toNumber(stage.hours)) || 0) * 60 + (Number(toNumber(stage.mins)) || 0)),
      fixed: stage.fixed,
    }))
    .filter((stage) => stage.name || stage.minutes > 0);
  const timing = stageSummary(stageRows.filter((stage) => stage.minutes > 0));

  function updateStage(key: string, changes: Partial<EditorStage>) {
    setStages((current) => current.map((stage) => (stage.key === key ? { ...stage, ...changes } : stage)));
  }

  const payload = JSON.stringify({
    id: product?.id,
    name,
    category,
    yieldQty: yieldNumber,
    yieldUnit,
    salePrice: sale,
    targetMargin: marginTarget,
    indirectPct: indirect.trim() === "" ? null : indirectPct,
    notes,
    lines: filled,
    stages: stageRows,
  });

  function update(key: string, changes: Partial<EditorLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...changes } : line)));
  }

  const marginTone =
    cost.margin === null ? "" : marginTarget !== null && cost.margin < marginTarget ? "neg" : cost.margin < 0 ? "neg" : "pos";

  return (
    <form action={saveProductAction} className="recipe">
      <input type="hidden" name="payload" value={payload} />

      <div className="recipe-main">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Produto</h2>
              <p>O rendimento é quanto UMA receita produz. O custo por unidade divide a receita por ele.</p>
            </div>
          </div>
          <div className="card-body">
            <div className="fields">
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label htmlFor="p-name">Nome do produto</label>
                <input id="p-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Bem-casado" required />
              </div>
              <div className="field">
                <label htmlFor="p-cat">Linha (opcional)</label>
                <input id="p-cat" list="p-cats" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Ex.: Doces, Bolos" />
                <datalist id="p-cats">
                  {categories.map((value) => <option key={value} value={value} />)}
                </datalist>
              </div>
              <div className="field">
                <label htmlFor="p-yield">Uma receita rende</label>
                <div className="input-pair">
                  <input id="p-yield" type="number" min="0.01" step="any" inputMode="decimal" value={yieldQty} onChange={(event) => setYieldQty(event.target.value)} placeholder="25" required />
                  <input aria-label="Unidade do rendimento" value={yieldUnit} onChange={(event) => setYieldUnit(event.target.value)} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="p-price">Preço de venda por unidade</label>
                <input id="p-price" type="number" min="0" step="any" inputMode="decimal" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} placeholder="R$ (opcional)" />
              </div>
              <div className="field">
                <label htmlFor="p-margin">Margem desejada (%)</label>
                <input id="p-margin" type="number" min="0" max="99" step="any" inputMode="decimal" value={targetMargin} onChange={(event) => setTargetMargin(event.target.value)} placeholder="Ex.: 60" />
              </div>
              <div className="field">
                <label htmlFor="p-indirect">Custos indiretos (%)</label>
                <input id="p-indirect" type="number" min="0" max="500" step="any" inputMode="decimal" value={indirect} onChange={(event) => setIndirect(event.target.value)} placeholder={`padrão ${String(Math.round(indirectDefault * 1000) / 10).replace(".", ",")}`} />
              </div>
              <div className="field wide">
                <label htmlFor="p-notes">Observação (opcional)</label>
                <input id="p-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Ingredientes e materiais</h2>
              <p>
                Unidades: g, kg, ml, L, un (unidade) ou emb. (embalagem inteira, como comprada). Quantidade de UMA receita. Marque &quot;por unidade&quot; para o que vai em cada peça (ex.: 1 embalagem por
                bem-casado): o sistema multiplica pelo rendimento.
              </p>
            </div>
          </div>
          <div className="card-body">
            <div className="lines">
              {lines.map((line, index) => {
                const result = cost.lines[index];
                const info = book[priceKey(costLines[index])];
                return (
                  <div className={`line recipe-line ${line.kind}`} key={line.key}>
                    <div className="field">
                      <label>Tipo</label>
                      <select
                        value={line.kind}
                        onChange={(event) => {
                          const kind = event.target.value as LineKind;
                          update(line.key, { ...blankLine(kind), key: line.key, kind });
                        }}
                      >
                        <option value="item">Estoque</option>
                        <option value="immediate">Uso imediato</option>
                        <option value="manual">Outro custo</option>
                      </select>
                    </div>
                    {line.kind === "manual" ? (
                      <>
                        <div className="field item-field">
                          <label>Descrição</label>
                          <input value={line.description} onChange={(event) => update(line.key, { description: event.target.value })} placeholder="Ex.: topper, gás extra" />
                        </div>
                        <div className="field">
                          <label>Valor (R$)</label>
                          <input type="number" min="0" step="any" inputMode="decimal" value={line.manualCost} onChange={(event) => update(line.key, { manualCost: event.target.value })} />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="field item-field">
                          <label>{line.kind === "item" ? `Item ${index + 1}` : `Item de uso imediato ${index + 1}`}</label>
                          <ItemPicker
                            key={`${line.key}-${line.kind}`}
                            name="pick"
                            options={line.kind === "item" ? itemOptions : immediateOptions}
                            defaultId={line.kind === "item" ? line.itemId : line.immediateItemId}
                            placeholder={line.kind === "item" ? "Buscar item do estoque…" : "Buscar item padrão…"}
                            onChange={(id) => update(line.key, line.kind === "item" ? { itemId: id } : { immediateItemId: id })}
                          />
                        </div>
                        <div className="field">
                          <label>Quantidade</label>
                          <div className="input-pair">
                            <input type="number" min="0" step="any" inputMode="decimal" value={line.quantity} onChange={(event) => update(line.key, { quantity: event.target.value })} />
                            <select aria-label="Unidade" value={line.unit} onChange={(event) => update(line.key, { unit: event.target.value as LineUnit })}>
                              {LINE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                            </select>
                          </div>
                        </div>
                      </>
                    )}
                    <div className="line-cost">
                      <span className="muted">Custo</span>
                      <strong>{money(result.cost)}</strong>
                    </div>
                    <button
                      className="btn btn-ghost remove"
                      type="button"
                      title="Remover linha"
                      aria-label={`Remover linha ${index + 1}`}
                      onClick={() => setLines((current) => (current.length === 1 ? [blankLine("item")] : current.filter((row) => row.key !== line.key)))}
                    >
                      <Icon name="x" size={16} />
                    </button>
                    <div className="line-extra recipe-extra">
                      <label className="save-standard">
                        <input type="checkbox" checked={line.perUnit} onChange={(event) => update(line.key, { perUnit: event.target.checked })} />
                        por unidade produzida{line.perUnit && yieldNumber > 0 ? ` (× ${qtyText(yieldNumber)})` : ""}
                      </label>
                      {line.kind !== "manual" && (info || result.warning) ? (
                        <span className={`line-note${result.severe ? " warn" : ""}`}>
                          {[priceText(info, line.kind), result.packages !== null && info?.price != null && line.unit !== "emb" ? `usa ${qtyText(result.packages)} embalagem(ns)` : "", result.warning || ""]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="form-actions" style={{ marginTop: 12 }}>
              <button className="btn" type="button" onClick={() => setLines((current) => [...current, blankLine("item")])}>
                <Icon name="plus" /> Item do estoque
              </button>
              <button className="btn" type="button" onClick={() => setLines((current) => [...current, blankLine("immediate")])}>
                <Icon name="plus" /> Uso imediato
              </button>
              <button className="btn" type="button" onClick={() => setLines((current) => [...current, blankLine("manual")])}>
                <Icon name="plus" /> Outro custo
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Etapas de produção</h2>
              <p>
                Tempo de UMA receita, dividido pelos dias em que cada parte é feita (ex.: Dia 1 massa, Dia 2 banhar e
                rechear, Dia 3 embalar). A agenda vai usar isso para distribuir as horas de cada pedido pelos dias certos.
              </p>
            </div>
          </div>
          <div className="card-body">
            {stages.length ? (
              <div className="lines">
                {stages.map((stage, index) => (
                  <div className="line stage-line" key={stage.key}>
                    <div className="field">
                      <label>Dia</label>
                      <select value={stage.day} onChange={(event) => updateStage(stage.key, { day: event.target.value })}>
                        {Array.from({ length: 10 }, (_, i) => String(i + 1))
                          .concat(Number(stage.day) > 10 ? [stage.day] : [])
                          .map((day) => <option key={day} value={day}>Dia {day}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>Etapa {index + 1}</label>
                      <input value={stage.name} onChange={(event) => updateStage(stage.key, { name: event.target.value })} placeholder="Ex.: massa, banhar e rechear, embalar" />
                    </div>
                    <div className="field">
                      <label>Tempo</label>
                      <div className="time-pair">
                        <input type="number" min="0" step="1" inputMode="numeric" value={stage.hours} onChange={(event) => updateStage(stage.key, { hours: event.target.value })} placeholder="0" aria-label={`Horas da etapa ${index + 1}`} />
                        <span>h</span>
                        <input type="number" min="0" step="1" inputMode="numeric" value={stage.mins} onChange={(event) => updateStage(stage.key, { mins: event.target.value })} placeholder="0" aria-label={`Minutos da etapa ${index + 1}`} />
                        <span>min</span>
                      </div>
                    </div>
                    <label className="save-standard" title="Ex.: montar a bancada ou limpar: leva o mesmo tempo para 1 ou 4 receitas">
                      <input type="checkbox" checked={stage.fixed} onChange={(event) => updateStage(stage.key, { fixed: event.target.checked })} />
                      tempo fixo
                    </label>
                    <button
                      className="btn btn-ghost remove"
                      type="button"
                      title="Remover etapa"
                      aria-label={`Remover etapa ${index + 1}`}
                      onClick={() => setStages((current) => current.filter((row) => row.key !== stage.key))}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>Nenhuma etapa ainda. Ex.: Dia 1 · Massa · 2 h.</p>
            )}
            <div className="form-actions" style={{ marginTop: 12, justifyContent: "space-between" }}>
              <button
                className="btn"
                type="button"
                onClick={() =>
                  setStages((current) => [
                    ...current,
                    { key: newKey(), name: "", day: current.length ? String(Number(current[current.length - 1].day) + 1) : "1", hours: "", mins: "", fixed: false },
                  ])
                }
              >
                <Icon name="plus" /> Etapa
              </button>
              {timing.days.length ? (
                <div className="stage-timeline" aria-label="Resumo das etapas por dia">
                  {timing.days.map((day) => (
                    <span key={day.day}>
                      <strong>Dia {day.day}</strong> {hoursText(day.minutes)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>
              &quot;Tempo fixo&quot;: não aumenta com a quantidade (ex.: montar a bancada). Sem marcar, o tempo é
              multiplicado pelo número de receitas do pedido. Pule um dia (Dia 1 e Dia 3) quando precisar esperar
              secar ou descansar.
            </p>
          </div>
        </section>
      </div>

      <aside className="recipe-side">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Custo de hoje</h2>
              <p>Pelo último preço pago de cada item.</p>
            </div>
          </div>
          <div className="card-body">
            <div className="cost-rows">
              <div><span>Ingredientes e materiais</span><strong>{money(cost.direct)}</strong></div>
              <div><span>Custos indiretos ({pct(indirectPct)})</span><strong>{money(cost.indirect)}</strong></div>
              <div className="total"><span>Custo da receita</span><strong>{money(cost.total)}</strong></div>
              <div className="hero">
                <span>Custo por {yieldUnit.replace(/s$/, "") || "unidade"}</span>
                <strong>{yieldNumber > 0 ? money(cost.perUnit) : "—"}</strong>
                <small>{yieldNumber > 0 ? `receita ÷ ${qtyText(yieldNumber)} ${yieldUnit}` : "informe o rendimento"}</small>
              </div>
              {sale !== null ? (
                <>
                  <div><span>Preço de venda</span><strong>{money(sale)}</strong></div>
                  <div><span>Margem atual</span><strong className={marginTone}>{cost.margin === null ? "—" : pct(cost.margin)}</strong></div>
                  <div><span>Lucro por unidade</span><strong>{money(sale - cost.perUnit)}</strong></div>
                </>
              ) : null}
              {cost.suggestedPrice !== null ? (
                <div className="suggest">
                  <span>Preço para margem de {pct(marginTarget || 0)}</span>
                  <strong>{money(cost.suggestedPrice)}</strong>
                </div>
              ) : null}
            </div>

            {timing.totalMinutes > 0 ? (
              <div className="composition">
                <h3>Tempo de produção</h3>
                <div className="cost-rows">
                  <div><span>Por receita</span><strong>{hoursText(timing.totalMinutes)}</strong></div>
                  <div><span>Dias de trabalho</span><strong>{timing.workDays}{timing.span > timing.workDays ? ` (em ${timing.span} dias)` : ""}</strong></div>
                  {yieldNumber > 0 ? (
                    <div><span>Por {yieldUnit.replace(/s$/, "") || "unidade"}</span><strong>{hoursText(timing.totalMinutes / yieldNumber)}</strong></div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {cost.direct > 0 ? (
              <div className="composition">
                <h3>Para onde vai o custo</h3>
                {Array.from(composition.entries())
                  .filter(([, value]) => value > 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([group, value]) => (
                    <div className="hbar" key={group}>
                      <div className="hbar-label">{group}</div>
                      <div className="hbar-track"><div className="hbar-fill" style={{ width: `${(value / cost.direct) * 100}%`, background: "var(--series-1)" }} /></div>
                      <div className="hbar-value">{pct(value / cost.direct)}</div>
                    </div>
                  ))}
                {ranking.length ? (
                  <p className="muted" style={{ marginTop: 10 }}>
                    Mais pesam: {ranking.map((row) => `${row.name} (${pct(row.cost / cost.direct)})`).join(", ")}.
                  </p>
                ) : null}
              </div>
            ) : null}

            {cost.warnings ? (
              <p className="line-note warn" style={{ marginTop: 10 }}>
                {cost.warnings} linha(s) sem preço ou com unidade que não combina: confira os avisos.
              </p>
            ) : null}

            <button className="btn btn-primary" type="submit" style={{ width: "100%", marginTop: 14 }}>
              {product ? "Salvar ficha" : "Cadastrar produto"}
            </button>
          </div>
        </section>
      </aside>
    </form>
  );
}
