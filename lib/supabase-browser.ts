import { createBrowserClient } from "@supabase/ssr";

// Cliente do Supabase no navegador: usado só para login, código do autenticador e saída.
export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
