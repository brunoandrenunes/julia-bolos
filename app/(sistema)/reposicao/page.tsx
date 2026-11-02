import Link from "next/link";
import { Fragment } from "react";
import { applyReplenishmentAction } from "@/app/actions";
import { CopyButton } from "@/components/client-ui";
import { Alert, Badge, Card, Empty, Flash, PageHead, PeriodHidden, Stat, Tabs } from "@/components/ui";
import { getReplenishment, type ReplenishmentRow } from "@/lib/analise";
import { getPeriodContext } from "@/lib/data";
import type { SearchParams } from "@/lib/types";
import { buildPeriodHref, currency, formatDate, quantity } from "@/lib/utils";
import { PeriodPicker, paramText } from "../_comum";

type PageProps = { searchParams?: Promise<SearchParams> };

const CYCLES = [7, 14, 21, 30];
const SAFETY = { "90": 1.28, "95": 1.65, "80": 0.84 } as const;
const LEAD_DAYS = 7;

const CONFIDENCE_TONE: Record<ReplenishmentRow["confidence"], "success" | "warning" | undefined> = {
  alta: "success",
  média: "warning",
  baixa: undefined,
  "sem consumo": undefined,
};

function days(value: number | null) {
  if (value === null) return "—";
  if (value > 365) return "+1 ano";
  return `${Math.floor(value)} dias`;
}

export default async function ReposicaoPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const cycle = CYCLES.includes(Number(paramText(params, "ciclo"))) ? Number(paramText(params, "ciclo")) : 14;
  const safetyKey = (paramText(params, "seguranca") in SAFETY ? paramText(params, "seguranca") : "90") as keyof typeof SAFETY;
  const requested = paramText(params, "aba");
  const tab = ["lista", "parametros", "excesso", "metodo"].includes(requested) ? requested : "lista";
  const [{ selected, options }, data] = await Promise.all([
    getPeriodContext(params),
    getReplenishment(params, { cycleDays: cycle, leadDays: LEAD_DAYS, z: SAFETY[safetyKey] }),
  ]);

  const toBuy = data.rows.filter((row) => row.status === "comprar").sort((a, b) => (a.coverageDays ?? 0) - (b.coverageDays ?? 0));
  const excess = data.rows
    .filter((row) => row.status === "excesso")
    .map((row) => ({ ...row, extra: row.currentQty - (row.savedTarget ?? row.suggestedTarget) }))
    .sort((a, b) => b.extra * b.unitPrice - a.extra * a.unitPrice);
  const withUse = data.rows.filter((row) => row.dailyUse > 0).sort((a, b) => b.monthlyUse * b.unitPrice - a.monthlyUse * a.unitPrice);
  const listCost = toBuy.reduce((sum, row) => sum + row.buyQty * (row.bestPrice || row.unitPrice), 0);
  const excessValue = excess.reduce((sum, row) => sum + row.extra * row.unitPrice, 0);
  const configured = data.rows.filter((row) => row.savedTarget != null).length;
  const extra = { ciclo: cycle, seguranca: safetyKey };
  const href = (aba: string) => buildPeriodHref("/reposicao", selected.year, selected.month, { ...extra, aba });

  const bySupplier = new Map<string, ReplenishmentRow[]>();
  toBuy.forEach((row) => {
    const key = row.lastSupplier || "Sem fornecedor definido";
    if (!bySupplier.has(key)) bySupplier.set(key, []);
    bySupplier.get(key)!.push(row);
  });
  const listText = [
    `Lista de compras — ${new Date().toLocaleDateString("pt-BR")}`,
    ...Array.from(bySupplier.entries()).flatMap(([supplier, rows]) => [
      "",
      `*${supplier}*`,
      ...rows.map((row) => `- ${row.name}: ${quantity(row.buyQty)}`),
    ]),
    "",
    `Estimativa: ${currency(listCost)}`,
  ].join("\n");

  return (
    <>
      <PageHead title="Reposição" description="Quanto ter de cada item para ir menos vezes ao mercado sem faltar nada.">
        <PeriodPicker options={options} selected={selected} />
      </PageHead>

      <Flash error={paramText(params, "error")} notice={paramText(params, "notice")} />

      {configured === 0 ? (
        <Alert
          tone="info"
          title="Mínimos ainda não definidos"
          action={<Link className="btn btn-sm" href={href("parametros")}>Revisar e salvar</Link>}
        >
          A lista abaixo usa os valores sugeridos pelo histórico. Revise e salve na aba Mínimos e alvos para valerem em todo o sistema.
        </Alert>
      ) : null}

      <form action="/reposicao" className="card filters" style={{ borderRadius: "var(--radius)" }}>
        <PeriodHidden year={selected.year} month={selected.month} aba={tab} />
        <div className="field">
          <label htmlFor="r-ciclo">Comprar cada item a cada</label>
          <select id="r-ciclo" name="ciclo" defaultValue={String(cycle)}>
            {CYCLES.map((value) => (
              <option key={value} value={value}>{value} dias</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="r-seg">Margem de segurança</label>
          <select id="r-seg" name="seguranca" defaultValue={safetyKey}>
            <option value="80">Menor (80%)</option>
            <option value="90">Equilibrada (90%)</option>
            <option value="95">Maior (95%)</option>
          </select>
        </div>
        <span className="muted" style={{ flex: "3 1 260px", alignSelf: "center" }}>
          Ciclo maior = menos idas ao mercado e mais dinheiro parado em estoque. Itens com ciclo próprio salvo usam o deles.
        </span>
        <button className="btn" type="submit">Recalcular</button>
      </form>

      <div className="stats">
        <Stat label="Comprar agora" value={String(toBuy.length)} note={toBuy.length ? `≈ ${currency(listCost)}` : "Nada abaixo do mínimo"} />
        <Stat label="Estoque em excesso" value={currency(excessValue)} note={`${excess.length} itens acima de 2 ciclos`} />
        <Stat label="Itens com consumo" value={String(withUse.length)} note={`${configured} com mínimo salvo`} />
        <Stat label="Base de cálculo" value={`${data.intervals} contagens`} note={data.lastCount ? `Última em ${formatDate(data.lastCount)}` : "Sem contagens"} />
      </div>

      <Tabs
        active={tab}
        tabs={[
          { key: "lista", label: "Lista de compras", count: toBuy.length, href: href("lista") },
          { key: "parametros", label: "Mínimos e alvos", count: withUse.length, href: href("parametros") },
          { key: "excesso", label: "Excesso", count: excess.length, href: href("excesso") },
          { key: "metodo", label: "Como é calculado", href: href("metodo") },
        ]}
      />

      {tab === "lista" ? (
        <Card
          title="Lista de compras"
          description={`Itens abaixo do mínimo no fim de ${selected.label.toLowerCase()}, separados pelo último fornecedor.`}
          actions={toBuy.length ? <CopyButton text={listText} label="Copiar para o WhatsApp" /> : null}
          flush
        >
          {toBuy.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Saldo</th>
                    <th className="num">Dura</th>
                    <th className="num">Mínimo</th>
                    <th className="num">Alvo</th>
                    <th className="num">Comprar</th>
                    <th className="num">Melhor preço (90 dias)</th>
                    <th className="num">Estimativa</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(bySupplier.entries()).map(([supplier, rows]) => (
                    <Fragment key={supplier}>
                      <tr className="total">
                        <td colSpan={8}>{supplier}</td>
                      </tr>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <strong>{row.name}</strong>{" "}
                            {row.currentQty <= 0 ? <Badge tone="danger">zerado</Badge> : null}
                            <span className="sub">usa ≈ {quantity(row.monthlyUse)}/mês</span>
                          </td>
                          <td className="num">{quantity(row.currentQty)}</td>
                          <td className="num">{days(row.coverageDays)}</td>
                          <td className="num">{quantity(row.savedTarget != null ? row.savedMin : row.suggestedMin)}</td>
                          <td className="num">{quantity(row.savedTarget ?? row.suggestedTarget)}</td>
                          <td className="num"><strong>{quantity(row.buyQty)}</strong></td>
                          <td className="num">{currency(row.bestPrice || row.unitPrice)}</td>
                          <td className="num">{currency(row.buyQty * (row.bestPrice || row.unitPrice))}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Nenhum item abaixo do mínimo. Bom momento para não ir ao mercado.</Empty>
          )}
        </Card>
      ) : null}

      {tab === "parametros" ? (
        <Card
          title="Mínimos e alvos por item"
          description="Sugestão calculada pelo consumo entre as contagens. Ajuste se quiser e salve os marcados."
          flush
        >
          <form action={applyReplenishmentAction}>
            <PeriodHidden year={selected.year} month={selected.month} aba="parametros" />
            <input type="hidden" name="ciclo" value={cycle} />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Salvar</th>
                    <th>Item</th>
                    <th className="num">Consumo/mês</th>
                    <th>Confiança</th>
                    <th className="num">Saldo</th>
                    <th className="num" style={{ width: 110 }}>Mínimo</th>
                    <th className="num" style={{ width: 110 }}>Alvo</th>
                    <th className="num" style={{ width: 100 }}>Ciclo (dias)</th>
                  </tr>
                </thead>
                <tbody>
                  {withUse.map((row) => {
                    const differs = row.savedTarget == null || row.savedMin !== row.suggestedMin || row.savedTarget !== row.suggestedTarget;
                    return (
                      <tr key={row.id}>
                        <td>
                          <input type="checkbox" name="aplicar" value={row.id} defaultChecked={row.savedTarget == null} aria-label={`Salvar ${row.name}`} />
                        </td>
                        <td>
                          <strong>{row.name}</strong>
                          <span className="sub">
                            {row.savedTarget != null
                              ? `salvo: mín. ${quantity(row.savedMin)} · alvo ${quantity(row.savedTarget)}${differs ? " (sugestão mudou)" : ""}`
                              : "ainda não salvo"}
                          </span>
                        </td>
                        <td className="num">
                          {quantity(row.monthlyUse)}
                          <span className="sub">variação {Math.round(row.variability * 100)}%</span>
                        </td>
                        <td><Badge tone={CONFIDENCE_TONE[row.confidence]}>{row.confidence}</Badge></td>
                        <td className="num">{quantity(row.currentQty)}</td>
                        <td className="num">
                          <div className="field"><input name={`min_${row.id}`} type="number" min="0" step="1" defaultValue={row.suggestedMin} style={{ textAlign: "right" }} aria-label={`Mínimo de ${row.name}`} /></div>
                        </td>
                        <td className="num">
                          <div className="field"><input name={`alvo_${row.id}`} type="number" min="0" step="1" defaultValue={row.suggestedTarget} style={{ textAlign: "right" }} aria-label={`Alvo de ${row.name}`} /></div>
                        </td>
                        <td className="num">
                          <div className="field"><input name={`ciclo_${row.id}`} type="number" min="1" max="120" step="1" defaultValue={row.savedCycle ?? ""} placeholder={String(cycle)} style={{ textAlign: "right" }} aria-label={`Ciclo de ${row.name}`} /></div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="filters" style={{ borderTop: "1px solid var(--border)", borderBottom: 0 }}>
              <span className="muted" style={{ flex: 1 }}>
                Para perecíveis (nata, morango, ovos), use ciclo menor, como 7 dias. O ciclo próprio do item recalcula o alvo na próxima abertura.
              </span>
              <button className="btn btn-primary" type="submit">Salvar marcados</button>
            </div>
          </form>
        </Card>
      ) : null}

      {tab === "excesso" ? (
        <Card title="Estoque acima do necessário" description="Mais de dois ciclos de consumo acima do alvo: dinheiro parado e risco de validade." flush>
          {excess.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Saldo</th>
                    <th className="num">Dura</th>
                    <th className="num">Alvo</th>
                    <th className="num">Excedente</th>
                    <th className="num">Valor parado</th>
                  </tr>
                </thead>
                <tbody>
                  {excess.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.name}</strong><span className="sub">usa ≈ {quantity(row.monthlyUse)}/mês</span></td>
                      <td className="num">{quantity(row.currentQty)}</td>
                      <td className="num">{days(row.coverageDays)}</td>
                      <td className="num">{quantity(row.savedTarget ?? row.suggestedTarget)}</td>
                      <td className="num">{quantity(row.extra)}</td>
                      <td className="num">{currency(row.extra * row.unitPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Nenhum item muito acima do necessário.</Empty>
          )}
        </Card>
      ) : null}

      {tab === "metodo" ? (
        <Card title="Como os números são calculados">
          <div className="form" style={{ maxWidth: 760, lineHeight: 1.6 }}>
            <p>
              <strong>Consumo diário.</strong> Para cada item, somamos as baixas de cada contagem e dividimos pelos dias
              desde a contagem anterior. Contagens com até 7 dias de diferença contam como uma só. Usamos os últimos
              7 meses. Quando um mês fica sem contagem (como setembro), o consumo da contagem seguinte é dividido pelos
              dois meses, então a média diária continua correta.
            </p>
            <p>
              <strong>Variação.</strong> Mede o quanto o consumo muda entre uma contagem e outra (meses com mais ou menos
              encomendas). Quanto maior a variação, maior a margem de segurança.
            </p>
            <p>
              <strong>Mínimo</strong> = consumo diário × {LEAD_DAYS} dias (até a próxima ida ao mercado) + margem de segurança.
              Se o saldo está abaixo do mínimo, o item entra na lista de compras.
            </p>
            <p>
              <strong>Alvo</strong> = mínimo + consumo diário × ciclo. Comprando até o alvo, o item só volta para a lista
              depois do ciclo escolhido (por exemplo, 14 dias).
            </p>
            <p>
              <strong>Confiança.</strong> Alta: 4 ou mais contagens e consumo estável. Média: 3 contagens. Baixa: poucos
              dados — revise o número antes de salvar.
            </p>
            <p className="muted">
              Limites: o sistema ainda não sabe a validade de cada item nem as promoções. Para perecíveis, use um ciclo
              menor no item. O preço de referência é o menor pago nos últimos 90 dias.
            </p>
          </div>
        </Card>
      ) : null}
    </>
  );
}
