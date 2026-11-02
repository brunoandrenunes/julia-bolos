"use client";

import { useEffect, useState } from "react";
import { THEME_KEY as KEY } from "@/lib/tema";

type Theme = "auto" | "light" | "dark";

export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "auto" || saved === "dark") setTheme(saved);
    } catch {
      // sem armazenamento: fica no claro
    }
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    const root = document.documentElement;
    if (next === "auto") delete root.dataset.theme;
    else root.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // ignora
    }
  }

  const options: [Theme, string][] = [
    ["light", "Claro"],
    ["dark", "Escuro"],
    ["auto", "Auto"],
  ];

  return (
    <div className="theme-switch" role="group" aria-label="Tema">
      {options.map(([value, label]) => (
        <button key={value} type="button" aria-pressed={theme === value} onClick={() => choose(value)}>
          {label}
        </button>
      ))}
    </div>
  );
}
