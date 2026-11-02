"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import type { PeriodOption } from "@/lib/types";

// Seletor de competência: troca o mês mantendo a tela e a aba atuais.
export function PeriodSelect({ options, selectedKey }: { options: PeriodOption[]; selectedKey: string }) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <label className="period">
      <span className="muted">Mês</span>
      <select
        value={selectedKey}
        aria-label="Mês de competência"
        onChange={(event) => {
          const [year, month] = event.target.value.split("-");
          const next = new URLSearchParams();
          next.set("year", year);
          next.set("month", month);
          const aba = params.get("aba");
          const scope = params.get("scope");
          if (aba) next.set("aba", aba);
          if (scope) next.set("scope", scope);
          router.push(`?${next.toString()}`);
        }}
      >
        {options.map((option) => {
          const key = `${option.year}-${String(option.month).padStart(2, "0")}`;
          return (
            <option key={key} value={key}>
              {option.label}
              {option.isClosed ? " · fechado" : ""}
            </option>
          );
        })}
      </select>
    </label>
  );
}

type PickerOption = { id: number; name: string; group?: string | null };

// Campo de escolha com busca: digita parte do nome e escolhe na lista.
// Envia o id no campo oculto `name`.
export function ItemPicker({
  name,
  options,
  defaultId,
  placeholder = "Digite para buscar…",
  required = false,
  id,
  onChange,
}: {
  name: string;
  options: PickerOption[];
  defaultId?: number | string | null;
  placeholder?: string;
  required?: boolean;
  id?: string;
  onChange?: (id: string) => void;
}) {
  const listId = useId();
  const byId = useMemo(() => new Map(options.map((option) => [String(option.id), option])), [options]);
  const byName = useMemo(
    () => new Map(options.map((option) => [option.name.toLowerCase(), option])),
    [options],
  );
  const initial = defaultId ? byId.get(String(defaultId)) : undefined;
  const [text, setText] = useState(initial?.name || "");
  const [selectedId, setSelectedId] = useState(initial ? String(initial.id) : "");
  const invalid = text !== "" && !selectedId;

  return (
    <>
      <input
        id={id}
        list={listId}
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        required={required}
        aria-invalid={invalid}
        onChange={(event) => {
          const value = event.target.value;
          setText(value);
          const match = byName.get(value.trim().toLowerCase());
          const nextId = match ? String(match.id) : "";
          setSelectedId(nextId);
          onChange?.(nextId);
        }}
        onBlur={(event) => {
          if (!selectedId) event.currentTarget.setCustomValidity(text ? "Escolha um item da lista." : "");
          else event.currentTarget.setCustomValidity("");
        }}
        onInput={(event) => event.currentTarget.setCustomValidity("")}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.id} value={option.name}>
            {option.group || ""}
          </option>
        ))}
      </datalist>
      <input type="hidden" name={name} value={selectedId} />
    </>
  );
}

// Botão que pede confirmação antes de enviar (exclusões, fechamento etc.).
export function ConfirmButton({
  children,
  message,
  className = "btn btn-sm btn-ghost btn-danger",
}: {
  children: React.ReactNode;
  message: string;
  className?: string;
}) {
  return (
    <button
      className={className}
      type="submit"
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

// Copia um texto pronto (ex.: lista de compras) para colar no WhatsApp.
export function CopyButton({ text, label = "Copiar lista" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-sm"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copie a lista:", text);
        }
      }}
    >
      {copied ? "Copiado!" : label}
    </button>
  );
}
