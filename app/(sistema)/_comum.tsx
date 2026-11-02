import { Suspense } from "react";
import { PeriodSelect } from "@/components/client-ui";
import type { PeriodOption, SearchParams } from "@/lib/types";
import { buildPeriodHref } from "@/lib/utils";

export function paramText(params: SearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export function periodKey(period: { year: number; month: number }) {
  return `${period.year}-${String(period.month).padStart(2, "0")}`;
}

// Link para uma aba da mesma tela, mantendo o mês.
export function tabHref(
  pathname: string,
  period: { year: number; month: number },
  aba: string,
  extra?: Record<string, string | number | undefined>,
) {
  return buildPeriodHref(pathname, period.year, period.month, { aba, ...extra });
}

export function PeriodPicker({ options, selected }: { options: PeriodOption[]; selected: PeriodOption }) {
  return (
    <Suspense fallback={null}>
      <PeriodSelect options={options} selectedKey={periodKey(selected)} />
    </Suspense>
  );
}
