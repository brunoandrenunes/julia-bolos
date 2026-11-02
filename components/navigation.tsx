"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { buildPeriodHref } from "@/lib/utils";

const items = [
  { href: "/", label: "Dashboard" },
  { href: "/estoque", label: "Estoque" },
  { href: "/compras", label: "Compras" },
  { href: "/movimentacoes", label: "Movimentações" },
  { href: "/financeiro", label: "Financeiro" },
  { href: "/relatorios", label: "Relatórios" },
];

export function Navigation() {
  const params = useSearchParams();
  const pathname = usePathname();
  const year = Number(params.get("year")) || 2026;
  const month = Number(params.get("month")) || 4;
  const scope = params.get("scope") || undefined;

  return (
    <nav className="nav-links">
      {items.map((item) => (
        <Link
          key={item.href}
          href={buildPeriodHref(item.href, year, month, { scope })}
          className={pathname === item.href ? "active" : ""}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
