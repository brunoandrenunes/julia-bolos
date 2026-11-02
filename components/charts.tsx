import clsx from "clsx";
import type { PeriodSummary } from "@/lib/types";
import { currency, percent } from "@/lib/utils";

type Point = { label: string; revenue: number; result: number };

function compact(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1000) return `${value < 0 ? "-" : ""}${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1).replace(".", ",")} mil`;
  return String(Math.round(value));
}

// Barras por mês: receita e resultado (verde quando sobra, vermelho quando falta).
export function TrendChart({ points }: { points: Point[] }) {
  const width = 640;
  const height = 240;
  const left = 52;
  const right = 12;
  const top = 12;
  const bottom = 28;
  const plotH = height - top - bottom;
  const values = points.flatMap((point) => [point.revenue, point.result, 0]);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const y = (value: number) => top + ((max - value) / range) * plotH;
  const groupW = (width - left - right) / Math.max(points.length, 1);
  const barW = Math.max(6, Math.min(18, groupW / 3.2));
  const ticks = [max, max / 2, 0, min < 0 ? min : null].filter((value): value is number => value !== null);

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label="Receita e resultado por mês">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "zero-line" : "grid-line"} />
            <text x={left - 8} y={y(tick) + 4} textAnchor="end" className="axis">
              {compact(tick)}
            </text>
          </g>
        ))}
        {points.map((point, index) => {
          const cx = left + groupW * index + groupW / 2;
          const revTop = Math.min(y(point.revenue), y(0));
          const resTop = Math.min(y(point.result), y(0));
          return (
            <g key={point.label}>
              <title>{`${point.label}: receita ${currency(point.revenue)}, resultado ${currency(point.result)}`}</title>
              <rect x={cx - barW - 2} y={revTop} width={barW} height={Math.max(Math.abs(y(point.revenue) - y(0)), 1)} rx={3} className="bar-revenue" />
              <rect x={cx + 2} y={resTop} width={barW} height={Math.max(Math.abs(y(point.result) - y(0)), 1)} rx={3} className={point.result >= 0 ? "bar-positive" : "bar-negative"} />
              <text x={cx} y={height - 8} textAnchor="middle" className="axis">
                {point.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="legend" style={{ marginTop: 8 }}>
        <span><i style={{ background: "var(--chart-1)" }} />Receita</span>
        <span><i style={{ background: "var(--chart-2)" }} />Resultado positivo</span>
        <span><i style={{ background: "var(--chart-3)" }} />Resultado negativo</span>
      </div>
    </div>
  );
}

// DRE em linhas, com o peso de cada uma sobre a receita.
export function DreList({ summary }: { summary: PeriodSummary }) {
  const revenue = summary.revenue || 0;
  const share = (value: number) => (revenue > 0 ? Math.abs(value) / revenue : 0);
  const rows: { label: string; value: number; kind?: "subtotal" | "result"; bar?: boolean }[] = [
    { label: "Receita", value: summary.revenue, kind: "subtotal" },
    { label: "(−) CMV (estoque usado)", value: -summary.cmv, bar: true },
    { label: "(−) Insumos de uso imediato", value: -summary.inputs, bar: true },
    { label: "(−) Despesas", value: -summary.expenses, bar: true },
    { label: summary.netProfit >= 0 ? "Lucro líquido" : "Prejuízo líquido", value: summary.netProfit, kind: "subtotal" },
    { label: "(−) Retiradas", value: -summary.withdrawals, bar: true },
    { label: "Resultado final", value: summary.result, kind: "result" },
  ];

  return (
    <div>
      {rows.map((row) => (
        <div key={row.label} className={clsx("dre-row", row.kind)}>
          <span>{row.label}</span>
          <span className="share">{revenue > 0 && row.label !== "Receita" ? percent(share(row.value)) : ""}</span>
          <span className={clsx("num", row.kind && (row.value >= 0 ? "pos" : "neg"))}>{currency(row.value)}</span>
          {row.bar ? (
            <div className="bar">
              <span style={{ width: `${Math.min(share(row.value), 1) * 100}%` }} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
