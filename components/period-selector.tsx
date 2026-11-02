"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { PeriodOption } from "@/lib/types";

export function PeriodSelector({
  options,
  selectedKey,
}: {
  options: PeriodOption[];
  selectedKey: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const selected = options.find(
    (option) => `${option.year}-${String(option.month).padStart(2, "0")}` === selectedKey,
  );

  return (
    <div className="period-card">
      <div className="period-selector-label">
        <span className="muted">Competência</span>
        {selected ? (
          <span className={`period-status ${selected.isClosed ? "closed" : "open"}`}>
            {selected.isClosed ? "Fechado" : "Em aberto"}
          </span>
        ) : null}
      </div>
      <select
        value={selectedKey}
        onChange={(event) => {
          const [year, month] = event.target.value.split("-");
          const next = new URLSearchParams(params.toString());
          next.set("year", year);
          next.set("month", month);
          router.push(`?${next.toString()}`);
        }}
      >
        {options.map((option) => {
          const key = `${option.year}-${String(option.month).padStart(2, "0")}`;
          return (
            <option key={key} value={key}>
              {option.label}{option.isClosed ? " - Fechado" : ""}
            </option>
          );
        })}
      </select>
    </div>
  );
}
