import { currency, percent } from "@/lib/utils";

type BreakdownRow = {
  label: string;
  value: number;
  note?: string;
};

export function BarChart({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: BreakdownRow[];
}) {
  const revenue = Math.max(rows.find((row) => row.label === "Receita")?.value || 0, 1);
  const finalResult = rows.find((row) => row.label === "Resultado final")?.value || 0;

  return (
    <div className="panel">
      <div className="page-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>

      <div className={`composition-hero ${finalResult >= 0 ? "positive" : "negative"}`}>
        <div>
          <div className="composition-eyebrow">Resultado do período</div>
          <strong>{finalResult >= 0 ? "Fechamento positivo" : "Fechamento negativo"}</strong>
          <p>
            {finalResult >= 0
              ? "Depois dos custos e retiradas, ainda sobrou caixa no período."
              : "Depois dos custos e retiradas, o período terminou no vermelho."}
          </p>
        </div>
        <div className={`composition-hero-value ${finalResult >= 0 ? "positive" : "negative"}`}>
          {currency(finalResult)}
        </div>
      </div>

      <div className="composition-list">
        {rows.map((row) => {
          const share = row.label === "Receita" ? 1 : Math.abs(row.value) / revenue;
          const tone =
            row.label === "Receita"
              ? "revenue"
              : row.label.includes("Lucro")
                ? "profit"
                : row.label.includes("Prejuízo")
                  ? "loss"
                  : row.label === "Resultado final"
                    ? row.value >= 0
                      ? "profit"
                      : "loss"
                    : "expense";

          const defaultNote =
            row.label === "Receita"
              ? "Base total do período"
              : row.label === "Resultado final"
                ? row.value >= 0
                  ? "Saldo restante após retiradas"
                  : "Déficit após retiradas"
                : `${percent(share)} da receita`;

          return (
            <div key={row.label} className={`composition-row ${tone}`}>
              <div className="composition-row-header">
                <strong>{row.label}</strong>
                <span className={`composition-badge ${tone}`}>
                  {row.label === "Receita"
                    ? "Entrada"
                    : row.label === "Resultado final"
                      ? row.value >= 0
                        ? "Saldo"
                        : "Déficit"
                      : row.value >= 0
                        ? "Favorece"
                        : "Consome"}
                </span>
              </div>
              <div className="composition-row-body">
                <div className="muted">{row.note || defaultNote}</div>
                <div className={`composition-value ${row.value >= 0 ? "positive" : "negative"}`}>
                  {currency(row.value)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
