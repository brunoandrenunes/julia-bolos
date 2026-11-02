import { redirect } from "next/navigation";
import { cache } from "react";
import { sessaoCompleta, testeLocalSemLogin } from "@/lib/sessao-regras";
import { createSupabaseServer } from "@/lib/supabase-server";

// Conferido em toda leitura e gravação do banco, não só na entrada do site.
export const exigirDono = cache(async () => {
  if (testeLocalSemLogin()) {
    return "teste-local";
  }
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  if (!sessaoCompleta(data?.claims)) {
    redirect("/login");
  }
  return String(data!.claims.email);
});
