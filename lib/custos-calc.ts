// Contas da ficha técnica, sem acesso ao banco: usadas na tela (ao digitar) e no servidor.
// Custo de cada linha = quantidade convertida em embalagens × último preço pago pela embalagem.

export type LineUnit = "g" | "kg" | "ml" | "l" | "un" | "emb";
export type ContentUnit = "g" | "ml" | "un";
export type LineKind = "item" | "immediate" | "manual";

export const LINE_UNITS: { value: LineUnit; label: string }[] = [
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "ml", label: "ml" },
  { value: "l", label: "L" },
  { value: "un", label: "un" },
  { value: "emb", label: "emb." },
];

// Preço e conteúdo da embalagem de cada item, como chegam do servidor.
export type PriceInfo = {
  price: number | null; // último preço pago por embalagem
  date: string | null;
  supplier: string | null;
  contentQty: number; // ex.: 395
  contentUnit: ContentUnit; // ex.: g
  contentSource: "cadastro" | "nome" | "padrão";
  perPurchase?: boolean; // uso imediato sem quantidade: preço é o da compra inteira
};

export type CostLine = {
  kind: LineKind;
  itemId?: number | null;
  immediateItemId?: number | null;
  description?: string | null;
  quantity: number;
  unit: LineUnit;
  perUnit: boolean;
  manualCost?: number | null;
};

const BASE: Record<LineUnit, { dim: ContentUnit | "emb"; factor: number }> = {
  g: { dim: "g", factor: 1 },
  kg: { dim: "g", factor: 1000 },
  ml: { dim: "ml", factor: 1 },
  l: { dim: "ml", factor: 1000 },
  un: { dim: "un", factor: 1 },
  emb: { dim: "emb", factor: 1 },
};

// Conteúdo pelo nome do item: "Leite condensado - 395g", "Óleo - 900ml", "Açúcar - Kg", "Leite de coco - L".
export function contentFromName(name: string): { qty: number; unit: ContentUnit } | null {
  const text = name.toLowerCase();
  const sized = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|dz)\b/);
  if (sized) {
    const value = Number(sized[1].replace(",", "."));
    if (!(value > 0)) return null;
    if (sized[2] === "kg") return { qty: value * 1000, unit: "g" };
    if (sized[2] === "g") return { qty: value, unit: "g" };
    if (sized[2] === "l") return { qty: value * 1000, unit: "ml" };
    if (sized[2] === "ml") return { qty: value, unit: "ml" };
    return { qty: value * 12, unit: "un" };
  }
  if (/(^|[\s-])kg\s*$/.test(text)) return { qty: 1000, unit: "g" };
  if (/(^|[\s-])l\s*$/.test(text)) return { qty: 1000, unit: "ml" };
  return null;
}

export type LineResult = {
  cost: number;
  packages: number | null; // quantas embalagens a linha consome por receita
  warning: string | null;
  severe: boolean; // aviso que impede o cálculo (sem preço, unidade incompatível)
};

export function lineCost(line: CostLine, yieldQty: number, info: PriceInfo | undefined): LineResult {
  const multiplier = line.perUnit ? Math.max(yieldQty, 0) : 1;
  if (line.kind === "manual") {
    return { cost: (Number(line.manualCost) || 0) * multiplier, packages: null, warning: null, severe: false };
  }
  // Linha ainda sem item escolhido: não conta nem gera aviso.
  if ((line.kind === "item" && !line.itemId) || (line.kind === "immediate" && !line.immediateItemId)) {
    return { cost: 0, packages: null, warning: null, severe: false };
  }
  if (!info) return { cost: 0, packages: null, warning: "Item não encontrado.", severe: true };
  const qty = (Number(line.quantity) || 0) * multiplier;
  const base = BASE[line.unit] || BASE.emb;
  let packages: number;
  let warning: string | null = null;
  if (base.dim === "emb") {
    packages = qty;
  } else {
    const amount = qty * base.factor;
    const contentDim = info.contentUnit;
    if (base.dim === contentDim) {
      packages = amount / info.contentQty;
    } else if ((base.dim === "g" && contentDim === "ml") || (base.dim === "ml" && contentDim === "g")) {
      packages = amount / info.contentQty;
      warning = "Considerando 1 ml ≈ 1 g.";
    } else {
      return {
        cost: 0,
        packages: null,
        severe: true,
        warning:
          contentDim === "un"
            ? "Custo não calculado: o item é contado por unidade/embalagem. Use \"unidade\" ou \"embalagem\", ou informe o conteúdo em Estoque › Itens."
            : "Custo não calculado: a unidade não combina com o conteúdo da embalagem.",
      };
    }
  }
  if (info.price == null) return { cost: 0, packages, warning: "Sem compra registrada: custo zerado.", severe: true };
  if (info.perPurchase && !warning) warning = "Preço da última compra inteira (a compra não informou quantidade).";
  return { cost: packages * info.price, packages, warning, severe: false };
}

export type ProductCost = {
  direct: number;
  indirect: number;
  total: number; // custo da receita
  perUnit: number; // custo por unidade produzida
  margin: number | null; // margem atual sobre o preço de venda
  suggestedPrice: number | null; // preço para atingir a margem-alvo
  lines: LineResult[];
  warnings: number;
};

export function productCost(
  product: { yieldQty: number; salePrice: number | null; targetMargin: number | null; indirectPct: number },
  lines: CostLine[],
  prices: (line: CostLine) => PriceInfo | undefined,
): ProductCost {
  const results = lines.map((line) => lineCost(line, product.yieldQty, prices(line)));
  const direct = results.reduce((sum, row) => sum + row.cost, 0);
  const indirect = direct * (product.indirectPct || 0);
  const total = direct + indirect;
  const perUnit = product.yieldQty > 0 ? total / product.yieldQty : total;
  const margin = product.salePrice && product.salePrice > 0 ? (product.salePrice - perUnit) / product.salePrice : null;
  const suggestedPrice =
    product.targetMargin != null && product.targetMargin < 1 && perUnit > 0 ? perUnit / (1 - product.targetMargin) : null;
  return {
    direct,
    indirect,
    total,
    perUnit,
    margin,
    suggestedPrice,
    lines: results,
    warnings: results.filter((row) => row.severe).length,
  };
}

export const priceKey = (line: Pick<CostLine, "kind" | "itemId" | "immediateItemId">) =>
  line.kind === "item" ? `i${line.itemId}` : line.kind === "immediate" ? `m${line.immediateItemId}` : "";

/* ---------- Etapas de produção (para a agenda) ---------- */

export type Stage = {
  name: string;
  day: number; // dia da produção: 1 = primeiro dia
  minutes: number; // tempo de UMA receita
  fixed: boolean; // true = não aumenta com o número de receitas
};

export function stageSummary(stages: Stage[]) {
  const byDay = new Map<number, number>();
  stages.forEach((stage) => byDay.set(stage.day, (byDay.get(stage.day) || 0) + stage.minutes));
  const days = Array.from(byDay.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([day, minutes]) => ({ day, minutes }));
  return {
    totalMinutes: stages.reduce((sum, stage) => sum + stage.minutes, 0),
    workDays: days.length, // dias com trabalho
    span: days.length ? days[days.length - 1].day - days[0].day + 1 : 0, // do primeiro ao último dia
    days,
  };
}

export function hoursText(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}
