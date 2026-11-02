"use client";

import { useEffect } from "react";
import { Icon } from "@/components/ui";
import { sairDoSistema, vigiarSessao } from "@/lib/sessao-navegador";

export function SessionGuard() {
  useEffect(() => vigiarSessao(), []);
  return (
    <button className="btn btn-ghost" type="button" onClick={() => void sairDoSistema()}>
      <Icon name="logout" />
      Sair
    </button>
  );
}
