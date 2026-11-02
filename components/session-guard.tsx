"use client";

import { useEffect } from "react";
import { sairDoSistema, vigiarSessao } from "@/lib/sessao-navegador";

export function SessionGuard() {
  useEffect(() => vigiarSessao(), []);
  return (
    <button className="secondary-button logout-button" type="button" onClick={() => void sairDoSistema()}>
      Sair
    </button>
  );
}
