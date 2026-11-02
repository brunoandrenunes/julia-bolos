import { format } from "date-fns";
import type { ReportScope } from "@/lib/types";

export function currency(value: number) {
  // Resíduos de arredondamento (ex.: -0,000000001) aparecem como R$ 0,00, não "-R$ 0,00".
  const rounded = Math.abs(value || 0) < 0.005 ? 0 : value;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(rounded);
}

export function quantity(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

export function percent(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value || 0);
}

export function toMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseMonthKey(key: string) {
  const [year, month] = key.split("-").map(Number);
  return { year, month };
}

export function monthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

export function isoToday() {
  return format(new Date(), "yyyy-MM-dd");
}

export function clampNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function cleanText(value: FormDataEntryValue | null) {
  return `${value || ""}`.trim();
}

export function buildPeriodHref(pathname: string, year: number, month: number, extra?: Record<string, string | number | undefined>) {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
  });
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && `${value}` !== "") {
      params.set(key, String(value));
    }
  });
  return `${pathname}?${params.toString()}`;
}

export function buildReportExportHref(scope: ReportScope, year: number, month: number) {
  const params = new URLSearchParams({
    scope,
    year: String(year),
    month: String(month),
  });
  return `/api/export?${params.toString()}`;
}
