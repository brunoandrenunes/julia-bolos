import { currency } from "@/lib/utils";

type Point = {
  label: string;
  revenue: number;
  result: number;
};

export function TrendChart({
  title,
  subtitle,
  points,
}: {
  title: string;
  subtitle: string;
  points: Point[];
}) {
  const width = 620;
  const height = 260;
  const padding = 30;
  const groupWidth = (width - padding * 2) / Math.max(points.length, 1);
  const barWidth = Math.min(26, Math.max(14, groupWidth / 3));
  const values = points.flatMap((point) => [point.revenue, point.result, 0]);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const baseline = height - padding - ((0 - min) / range) * (height - padding * 2);

  const yForValue = (value: number) =>
    height - padding - ((value - min) / range) * (height - padding * 2);

  return (
    <div className="panel">
      <div className="page-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img">
        <line x1={padding} x2={width - padding} y1={baseline} y2={baseline} className="chart-grid-line strong" />
        {[0.2, 0.4, 0.6, 0.8].map((step) => {
          const y = padding + step * (height - padding * 2);
          return <line key={step} x1={padding} x2={width - padding} y1={y} y2={y} className="chart-grid-line" />;
        })}

        {points.map((point, index) => {
          const groupStart = padding + index * groupWidth + groupWidth / 2 - barWidth - 6;
          const revenueTop = yForValue(point.revenue);
          const revenueHeight = Math.abs(baseline - revenueTop);
          const resultTop = point.result >= 0 ? yForValue(point.result) : baseline;
          const resultHeight = Math.abs(yForValue(point.result) - baseline);
          const resultIsNegative = point.result < 0;

          return (
            <g key={point.label}>
              <rect
                x={groupStart}
                y={Math.min(revenueTop, baseline)}
                width={barWidth}
                height={Math.max(revenueHeight, 2)}
                rx={8}
                className="chart-bar revenue"
              />
              <rect
                x={groupStart + barWidth + 12}
                y={resultTop}
                width={barWidth}
                height={Math.max(resultHeight, 2)}
                rx={8}
                className={`chart-bar ${resultIsNegative ? "result-negative" : "result-positive"}`}
              />
              <text
                x={groupStart + barWidth + 6}
                y={height - 8}
                textAnchor="middle"
                className="chart-axis-label"
              >
                {point.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="chart-legend">
        <span className="legend-chip">
          <span className="legend-swatch revenue" />
          Receita
        </span>
        <span className="legend-chip">
          <span className="legend-swatch result-positive" />
          Resultado positivo
        </span>
        <span className="legend-chip">
          <span className="legend-swatch result-negative" />
          Resultado negativo
        </span>
      </div>

      <div className="list" style={{ marginTop: 16 }}>
        {points.map((point) => (
          <div className="list-item" key={point.label}>
            <strong>{point.label}</strong>
            <div style={{ textAlign: "right" }}>
              <div>{currency(point.revenue)}</div>
              <div className="muted">Resultado {currency(point.result)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
