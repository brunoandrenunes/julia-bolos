import { Suspense } from "react";
import { Navigation } from "@/components/navigation";
import { SessionGuard } from "@/components/session-guard";
import { ThemeSwitch } from "@/components/theme-switch";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">JR</div>
          <div>
            <strong>Julia Ronsoni</strong>
            <span>Bolos · Gestão</span>
          </div>
        </div>
        <Suspense fallback={<nav className="nav" />}>
          <Navigation />
        </Suspense>
        <div className="sidebar-footer">
          <ThemeSwitch />
          <SessionGuard />
        </div>
      </aside>
      <main className="main">
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
