import { redirect } from "next/navigation";
import type { SearchParams } from "@/lib/types";

// A antiga tela "Movimentações" foi incorporada ao Estoque (abas Contagem e Entradas).
export default async function MovimentacoesPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = (await searchParams) || {};
  const next = new URLSearchParams();
  if (params.year) next.set("year", String(params.year));
  if (params.month) next.set("month", String(params.month));
  next.set("aba", params.editEntrada ? "entradas" : "contagem");
  redirect(`/estoque?${next.toString()}`);
}
