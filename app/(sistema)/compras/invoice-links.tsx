"use client";

import { useState } from "react";
import { deleteInvoiceLinkAction, saveInvoiceLinkAction } from "@/app/actions";
import { ConfirmButton, ItemPicker, type PickerOption } from "@/components/client-ui";
import type { InvoiceLinkRow } from "@/lib/nfce";

const DESTINATIONS = [
  { value: "inventory", label: "Estoque" },
  { value: "financial", label: "Uso imediato" },
  { value: "personal", label: "Casa (retirada)" },
  { value: "skip", label: "Não importar" },
] as const;

// Uma linha editável: produto da nota → o que o sistema faz com ele nas próximas notas.
function LinkRow({ row, itemOptions, year, month }: { row: InvoiceLinkRow; itemOptions: PickerOption[]; year: number; month: number }) {
  const [destination, setDestination] = useState(row.destination);
  return (
    <tr>
      <td>
        <strong>{row.description}</strong>
        <span className="sub">{row.supplierName}</span>
      </td>
      <td colSpan={2}>
        <form action={saveInvoiceLinkAction} className="link-form">
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="month" value={month} />
          <select name="destination" value={destination} onChange={(event) => setDestination(event.target.value as InvoiceLinkRow["destination"])} aria-label="Destino">
            {DESTINATIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {destination === "inventory" ? (
            <>
              <ItemPicker name="itemId" options={itemOptions} defaultId={row.itemId} placeholder="Item do estoque…" required />
              <label className="factor" title="Quantas unidades do item do sistema vêm em 1 unidade da nota (ex.: 1 dúzia = 12 ovos; pacote de 5 kg = 5)">
                ×
                <input name="qtyFactor" type="number" min="0.001" step="any" defaultValue={row.qtyFactor} aria-label="Conversão" />
              </label>
            </>
          ) : destination === "financial" || destination === "personal" ? (
            <input name="financialDescription" defaultValue={row.financialDescription || row.description} placeholder="Descrição" aria-label="Descrição" />
          ) : (
            <span className="muted">fica de fora da compra</span>
          )}
          <button className="btn btn-sm" type="submit">Salvar</button>
        </form>
      </td>
      <td className="num">
        <form action={deleteInvoiceLinkAction}>
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="month" value={month} />
          <ConfirmButton message={`Excluir o vínculo de "${row.description}"? Na próxima nota o sistema volta a sugerir pelo nome.`}>Excluir</ConfirmButton>
        </form>
      </td>
    </tr>
  );
}

export function InvoiceLinks({ rows, itemOptions, year, month }: { rows: InvoiceLinkRow[]; itemOptions: PickerOption[]; year: number; month: number }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = q ? rows.filter((row) => `${row.description} ${row.supplierName} ${row.itemName || ""}`.toLowerCase().includes(q)) : rows;
  return (
    <>
      <div className="filters">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="links-q">Buscar</label>
          <input id="links-q" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Produto, mercado ou item do sistema" />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto na nota</th>
              <th colSpan={2}>Nas próximas notas</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => <LinkRow key={`${row.id}-${row.updatedAt}`} row={row} itemOptions={itemOptions} year={year} month={month} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}
