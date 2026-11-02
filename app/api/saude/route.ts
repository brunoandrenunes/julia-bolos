import { NextResponse } from "next/server";
import { verificarConexao } from "@/lib/db";

export const dynamic = "force-dynamic";

// Verificação pública de funcionamento: diz só se o banco responde, sem nenhum dado.
export async function GET() {
  try {
    await verificarConexao();
    return NextResponse.json({ banco: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ banco: "erro" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
