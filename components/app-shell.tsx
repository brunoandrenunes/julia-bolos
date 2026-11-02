import { Suspense } from "react";
import { Navigation } from "@/components/navigation";
import { SessionGuard } from "@/components/session-guard";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <div className="top-bar">
        <div className="brand">
          <div className="brand-mark">JR</div>
          <div>
            <h2>Julia Ronsoni Bolos</h2>
            <p>Estoque, compras, caixa e DRE mensal.</p>
          </div>
        </div>

        <Suspense fallback={<nav className="nav-links" />}>
          <Navigation />
        </Suspense>
        <SessionGuard />
      </div>

      {children}
    </div>
  );
}
