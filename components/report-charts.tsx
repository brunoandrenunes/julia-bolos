"use client";

import { useState } from "react";

// Gráficos dos relatórios. Cores por papel (CSS --series-N); texto sempre na cor do texto.
// Passe o mouse (ou toque) para ver os valores de cada mês.

export type Format = "currency" | "number" | "percent" | "days";
export type Series = { name: string; color: string };

function fmt(value: number, format: Format) {
  if (format === "currency") return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  if (format === "percent") return `${(value * 100).toFixed(1).replace(".", ",")}%`;
  if (format === "days") return `${Math.round(value)} dias`;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}

function axisLabel(value: number, format: Format) {
  if (format === "percent") return `${Math.round(value * 100)}%`;
  const abs = Math.abs(value);
  if (format === "currency" && abs >= 1000) return `${value < 0 ? "-" : ""}${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1).replace(".", ",")} mil`;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * exp >= value) || 10;
  return step * exp;
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="legend">
      {series.map((item) => (
        <span key={item.name}>
          <i style={{ background: item.color }} />
          {item.name}
        </span>
      ))}
    </div>
  );
}

type TipState = { x: number; y: number; index: number } | null;

function Tooltip({ tip, title, rows, format }: { tip: TipState; title: string; rows: { name: string; color: string; value: number }[]; format: Format }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
      <div className="chart-tip-title">{title}</div>
      {rows.map((row) => (
        <div key={row.name} className="chart-tip-row">
          <i style={{ background: row.color }} />
          <span>{row.name}</span>
          <strong>{fmt(row.value, format)}</strong>
        </div>
      ))}
    </div>
  );
}

const W = 640;
const H = 260;
const PAD = { left: 56, right: 12, top: 14, bottom: 30 };

// Colunas por mês: empilhadas (partes de um todo) ou lado a lado (comparação).
export function ColumnChart({
  labels,
  series,
  values,
  format = "currency",
  stacked = false,
  polarity = false,
  height = H,
}: {
  labels: string[];
  series: Series[];
  values: number[][]; // values[serie][mes]
  format?: Format;
  stacked?: boolean;
  polarity?: boolean; // 1 série: verde se positivo, vermelho se negativo
  height?: number;
}) {
  const [tip, setTip] = useState<TipState>(null);
  const n = labels.length;
  const totals = labels.map((_, i) => series.reduce((sum, _s, k) => sum + Math.max(values[k][i] || 0, 0), 0));
  const flat = stacked ? totals : values.flat();
  const max = niceMax(Math.max(...flat, 0));
  const min = Math.min(...values.flat(), 0) < 0 ? -niceMax(-Math.min(...values.flat(), 0)) : 0;
  const plotH = height - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + ((max - v) / (max - min || 1)) * plotH;
  const groupW = (W - PAD.left - PAD.right) / Math.max(n, 1);
  const barW = stacked || series.length === 1 ? Math.min(30, groupW * 0.55) : Math.min(18, (groupW * 0.7) / series.length);
  const ticks = [min, min / 2, 0, max / 2, max].filter((v, i, arr) => arr.indexOf(v) === i);

  return (
    <div className="chart-wrap" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "zero-line" : "grid-line"} />
            <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" className="axis">{axisLabel(tick, format)}</text>
          </g>
        ))}
        {labels.map((label, i) => {
          const cx = PAD.left + groupW * i + groupW / 2;
          let stackTop = 0;
          return (
            <g key={label}>
              <rect
                x={cx - groupW / 2}
                y={PAD.top}
                width={groupW}
                height={plotH}
                fill="transparent"
                onMouseMove={(event) => {
                  const box = (event.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setTip({ x: ((cx + groupW / 2) / W) * box.width, y: 8, index: i });
                }}
                onClick={(event) => {
                  const box = (event.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setTip({ x: ((cx + groupW / 2) / W) * box.width, y: 8, index: i });
                }}
              />
              {tip?.index === i ? <rect x={cx - groupW / 2} y={PAD.top} width={groupW} height={plotH} className="chart-hover" pointerEvents="none" /> : null}
              {series.map((s, k) => {
                const v = values[k][i] || 0;
                if (stacked) {
                  const h = Math.max(((Math.max(v, 0)) / (max - min || 1)) * plotH, 0);
                  const top = y(stackTop + Math.max(v, 0));
                  stackTop += Math.max(v, 0);
                  return h > 0 ? <rect key={s.name} x={cx - barW / 2} y={top + 1} width={barW} height={Math.max(h - 2, 1)} rx={2} fill={s.color} pointerEvents="none" /> : null;
                }
                const x = series.length === 1 ? cx - barW / 2 : cx - (barW * series.length + 3 * (series.length - 1)) / 2 + k * (barW + 3);
                const top = Math.min(y(v), y(0));
                const color = polarity ? (v >= 0 ? "var(--positive)" : "var(--negative)") : s.color;
                return <rect key={s.name} x={x} y={top} width={barW} height={Math.max(Math.abs(y(v) - y(0)), 1)} rx={3} fill={color} pointerEvents="none" />;
              })}
              <text x={cx} y={height - 9} textAnchor="middle" className="axis">{label}</text>
            </g>
          );
        })}
      </svg>
      <Tooltip
        tip={tip}
        title={tip ? labels[tip.index] : ""}
        format={format}
        rows={
          tip
            ? [
                ...series.map((s, k) => ({ name: s.name, color: polarity ? ((values[k][tip.index] || 0) >= 0 ? "var(--positive)" : "var(--negative)") : s.color, value: values[k][tip.index] || 0 })),
                ...(stacked && series.length > 1 ? [{ name: "Total", color: "transparent", value: totals[tip.index] }] : []),
              ]
            : []
        }
      />
      <Legend series={series} />
    </div>
  );
}

// Linhas ao longo do tempo, com linha-guia vertical e valores de todas as séries.
export function LineChart({
  labels,
  series,
  values,
  format = "currency",
  height = H,
  zeroBased = true,
}: {
  labels: string[];
  series: Series[];
  values: (number | null)[][];
  format?: Format;
  height?: number;
  zeroBased?: boolean;
}) {
  const [tip, setTip] = useState<TipState>(null);
  const all = values.flat().filter((v): v is number => v !== null);
  const rawMax = Math.max(...all, 0);
  const rawMin = Math.min(...all, zeroBased ? 0 : rawMax);
  const max = niceMax(rawMax);
  const min = zeroBased ? (rawMin < 0 ? -niceMax(-rawMin) : 0) : Math.max(rawMin - (rawMax - rawMin) * 0.15, 0);
  const plotH = height - PAD.top - PAD.bottom;
  const n = labels.length;
  const step = (W - PAD.left - PAD.right) / Math.max(n - 1, 1);
  const x = (i: number) => (n === 1 ? (W + PAD.left - PAD.right) / 2 : PAD.left + step * i);
  const y = (v: number) => PAD.top + ((max - v) / (max - min || 1)) * plotH;
  const ticks = [min, (min + max) / 2, max];

  return (
    <div className="chart-wrap" onMouseLeave={() => setTip(null)}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="chart"
        role="img"
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const px = ((event.clientX - box.left) / box.width) * W;
          const index = Math.min(Math.max(Math.round((px - PAD.left) / (step || 1)), 0), n - 1);
          setTip({ x: (x(index) / W) * box.width + 8, y: 8, index });
        }}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "zero-line" : "grid-line"} />
            <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" className="axis">{axisLabel(tick, format)}</text>
          </g>
        ))}
        {labels.map((label, i) =>
          n <= 14 || i % Math.ceil(n / 12) === 0 ? (
            <text key={`${label}-${i}`} x={x(i)} y={height - 9} textAnchor="middle" className="axis">{label}</text>
          ) : null,
        )}
        {tip ? <line x1={x(tip.index)} x2={x(tip.index)} y1={PAD.top} y2={height - PAD.bottom} className="zero-line" /> : null}
        {series.map((s, k) => {
          const points = values[k].map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
          return (
            <g key={s.name}>
              <polyline points={points.join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
              {values[k].map((v, i) =>
                v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={tip?.index === i ? 5 : 3} fill={s.color} stroke="var(--surface)" strokeWidth={2} />,
              )}
            </g>
          );
        })}
      </svg>
      <Tooltip
        tip={tip}
        title={tip ? labels[tip.index] : ""}
        format={format}
        rows={tip ? series.map((s, k) => ({ name: s.name, color: s.color, value: values[k][tip.index] ?? 0 })) : []}
      />
      <Legend series={series} />
    </div>
  );
}
