import Link from "next/link";
import type { ReportScope } from "@/lib/types";
import { buildPeriodHref } from "@/lib/utils";

export function ReportScopeSwitch({
  pathname,
  scope,
  year,
  month,
}: {
  pathname: string;
  scope: ReportScope;
  year: number;
  month: number;
}) {
  return (
    <div className="pill-row">
      <Link
        className={scope === "month" ? "button" : "secondary-button"}
        href={buildPeriodHref(pathname, year, month, { scope: "month" })}
      >
        Visao mensal
      </Link>
      <Link
        className={scope === "year" ? "button" : "secondary-button"}
        href={buildPeriodHref(pathname, year, month, { scope: "year" })}
      >
        Consolidado anual
      </Link>
    </div>
  );
}

