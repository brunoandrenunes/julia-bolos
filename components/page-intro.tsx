import { Suspense } from "react";
import { PeriodSelector } from "@/components/period-selector";
import type { PeriodOption } from "@/lib/types";

export function PageIntro({
  title,
  description,
  options,
  selectedKey,
}: {
  title: string;
  description: string;
  options: PeriodOption[];
  selectedKey: string;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <Suspense fallback={<div className="period-card" />}>
        <PeriodSelector options={options} selectedKey={selectedKey} />
      </Suspense>
    </div>
  );
}
