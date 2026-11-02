"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import type { PeriodOption } from "@/lib/types";
import { normalizeText } from "@/lib/utils";

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

export type PickerOption = { id: number; name: string; group?: string | null };

function filterOptions(options: PickerOption[], text: string) {
  const words = normalizeText(text).split(/\s+/).filter(Boolean);
  if (!words.length) return options.slice(0, 60);
  const scored = options
    .map((option) => {
      const name = normalizeText(option.name);
      const haystack = `${name} ${normalizeText(option.group || "")}`;
      if (!words.every((word) => haystack.includes(word))) return null;
      return { option, score: name.startsWith(words[0]) ? 0 : name.includes(words[0]) ? 1 : 2 };
    })
    .filter((row): row is { option: PickerOption; score: number } => row !== null);
  return scored.sort((a, b) => a.score - b.score).slice(0, 60).map((row) => row.option);
}

// Campo com lista de busca própria: mostra o nome do item (e a categoria ao lado),
// aceita parte do nome, sem acento, e navega pelas setas + Enter.
function SearchField({
  id,
  inputName,
  text,
  options,
  placeholder,
  required,
  invalid,
  onText,
  onPick,
  onBlur,
}: {
  id?: string;
  inputName?: string;
  text: string;
  options: PickerOption[];
  placeholder?: string;
  required?: boolean;
  invalid?: boolean;
  onText: (text: string) => void;
  onPick: (option: PickerOption) => void;
  onBlur?: (input: HTMLInputElement) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => filterOptions(options, text), [options, text]);
  const showList = open && matches.length > 0;

  function pick(option: PickerOption) {
    onPick(option);
    setOpen(false);
  }

  return (
    <div className="combo">
      <input
        id={id}
        name={inputName}
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        required={required}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        aria-invalid={invalid}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          event.currentTarget.setCustomValidity("");
          onText(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((current) => Math.min(current + 1, matches.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((current) => Math.max(current - 1, 0));
          } else if (event.key === "Enter" && showList) {
            event.preventDefault();
            pick(matches[Math.min(active, matches.length - 1)]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        onBlur={(event) => {
          setOpen(false);
          onBlur?.(event.currentTarget);
        }}
      />
      {showList ? (
        <ul className="combo-list" id={listId} role="listbox">
          {matches.map((option, index) => (
            <li
              key={option.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? "combo-option active" : "combo-option"}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(option);
              }}
              onMouseEnter={() => setActive(index)}
            >
              <span className="combo-name">{option.name}</span>
              {option.group ? <span className="combo-group">{option.group}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Escolha obrigatória de um item da lista. Envia o id no campo oculto `name`.
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
  const byId = useMemo(() => new Map(options.map((option) => [String(option.id), option])), [options]);
  const byName = useMemo(
    () => new Map(options.map((option) => [normalizeText(option.name), option])),
    [options],
  );
  const initial = defaultId ? byId.get(String(defaultId)) : undefined;
  const [text, setText] = useState(initial?.name || "");
  const [selectedId, setSelectedId] = useState(initial ? String(initial.id) : "");

  function select(nextId: string) {
    setSelectedId(nextId);
    onChange?.(nextId);
  }

  return (
    <>
      <SearchField
        id={id}
        text={text}
        options={options}
        placeholder={placeholder}
        required={required}
        invalid={text !== "" && !selectedId}
        onText={(value) => {
          setText(value);
          const match = byName.get(normalizeText(value));
          select(match ? String(match.id) : "");
        }}
        onPick={(option) => {
          setText(option.name);
          select(String(option.id));
        }}
        onBlur={(input) => input.setCustomValidity(!selectedId && text ? "Escolha um item da lista." : "")}
      />
      <input type="hidden" name={name} value={selectedId} />
    </>
  );
}

// Texto livre com sugestões (ex.: itens padrão de uso imediato). Envia o texto em `name`.
export function SuggestInput({
  id,
  name,
  value,
  options,
  placeholder,
  required,
  onChange,
  onPick,
}: {
  id?: string;
  name: string;
  value: string;
  options: PickerOption[];
  placeholder?: string;
  required?: boolean;
  onChange: (text: string) => void;
  onPick?: (option: PickerOption) => void;
}) {
  return (
    <SearchField
      id={id}
      inputName={name}
      text={value}
      options={options}
      placeholder={placeholder}
      required={required}
      onText={onChange}
      onPick={(option) => {
        onChange(option.name);
        onPick?.(option);
      }}
    />
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

// Descrição do lançamento com sugestão dos itens padrão e opção de salvar um novo.
export function StandardDescriptionField({
  id,
  name,
  defaultValue,
  options,
  placeholder,
}: {
  id?: string;
  name: string;
  defaultValue?: string;
  options: PickerOption[];
  placeholder?: string;
}) {
  const [text, setText] = useState(defaultValue || "");
  const known = useMemo(() => new Set(options.map((option) => normalizeText(option.name))), [options]);
  const isStandard = known.has(normalizeText(text));
  return (
    <>
      <SuggestInput id={id} name={name} value={text} options={options} placeholder={placeholder} required onChange={setText} />
      {text.trim() && !isStandard ? (
        <label className="save-standard" style={{ marginTop: 6 }}>
          <input type="checkbox" name="saveStandard" value="1" />
          Salvar como item padrão (vale para Insumos e Despesa)
        </label>
      ) : null}
    </>
  );
}
