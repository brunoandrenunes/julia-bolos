"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui";

const items = [
  { href: "/", label: "Painel", icon: "home" },
  { href: "/compras", label: "Compras", icon: "cart" },
  { href: "/estoque", label: "Estoque", icon: "box" },
  { href: "/reposicao", label: "Reposição", icon: "list" },
  { href: "/custos", label: "Custos", icon: "tag" },
  { href: "/financeiro", label: "Financeiro", icon: "wallet" },
  { href: "/relatorios", label: "Relatórios", icon: "chart" },
] as const;

// Ao trocar de tela, mantém o mês escolhido (se houver); sem mês, cada tela abre no mês atual.
export function Navigation() {
  const params = useSearchParams();
  const pathname = usePathname();
  const year = params.get("year");
  const month = params.get("month");
  const query = year && month ? `?year=${year}&month=${month}` : "";

  return (
    <nav className="nav" aria-label="Menu principal">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={`${item.href}${query}`} className={active ? "active" : ""}>
            <Icon name={item.icon} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
