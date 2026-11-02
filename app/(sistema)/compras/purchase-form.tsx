"use client";

import { useState } from "react";
import { savePurchaseAction } from "@/app/actions";
import { ItemPicker, SuggestInput } from "@/components/client-ui";
import { Icon } from "@/components/ui";
import type { ItemRecord, MovementType, PaymentMethod, PurchaseRecord, SupplierRecord } from "@/lib/types";
import type { ImmediateItem } from "@/lib/uso-imediato";
import { normalizeText } from "@/lib/utils";

type PurchaseFormProps = {
  year: number;
  month: number;
  defaultDate: string;
  disabled: boolean;
  suppliers: SupplierRecord[];
  paymentMethods: PaymentMethod[];
  movementTypes: MovementType[];
  items: ItemRecord[];
  purchase?: PurchaseRecord | null;
  immediateItems: ImmediateItem[];
};

type EditableLine = {
  key: string;
  destination: "inventory" | "financial";
  itemId: string;
  description: string;
  quantity: string;
  amount: string;
  unitPrice: string;
  // Qual valor a pessoa digitou por último: o outro é calculado.
  anchor: "unit" | "total";
  movementTypeId: string;
  saveStandard: boolean;
};

let nextLineId = 1;

function newLine(destination: "inventory" | "financial", movementTypeId?: number): EditableLine {
  return {
    key: `new-${nextLineId++}`,
    destination,
    itemId: "",
    description: "",
    quantity: "1",
    amount: "",
    unitPrice: "",
    anchor: "unit",
    movementTypeId: String(movementTypeId || ""),
    saveStandard: false,
  };
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// Recalcula o valor que não foi digitado (total = quantidade × preço por unidade).
function recalc(line: EditableLine): EditableLine {
  const qty = Number(line.quantity);
  if (!(qty > 0)) return line;
  if (line.anchor === "unit") {
    const unit = Number(line.unitPrice);
    return { ...line, amount: line.unitPrice === "" ? "" : String(round(qty * unit, 2)) };
  }
  const total = Number(line.amount);
  return { ...line, unitPrice: line.amount === "" ? "" : String(round(total / qty, 4)) };
}

function initialLines(purchase: PurchaseRecord | null | undefined, movementTypeId?: number) {
  if (!purchase?.lines?.length) return [newLine("inventory", movementTypeId)];
  return purchase.lines.map((line) => ({
    key: `saved-${line.id}`,
    destination: line.destination,
    itemId: String(line.item_id || ""),
    description: line.description,
    quantity: String(line.quantity),
    amount: String(line.total_amount),
    unitPrice: line.quantity ? String(round(line.total_amount / line.quantity, 4)) : "",
    anchor: "total" as const,
    movementTypeId: String(line.movement_type_id || movementTypeId || ""),
    saveStandard: false,
  }));
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function PurchaseForm({
  year,
  month,
  defaultDate,
  disabled,
  suppliers,
  paymentMethods,
  movementTypes,
  items,
  purchase,
  immediateItems,
}: PurchaseFormProps) {
  const defaultMovementType = movementTypes.find((type) => type.name === "Insumos")?.id;
  const [lines, setLines] = useState<EditableLine[]>(() => initialLines(purchase, defaultMovementType));
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const total = round(lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0), 2);
  const invoiceDiff = invoiceTotal === "" ? null : round(Number(invoiceTotal) - total, 2);
  const itemOptions = items.map((item) => ({ id: item.id, name: item.name, group: item.category_name }));
  const supplierOptions = suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }));
  const standardOptions = immediateItems.map((item) => ({
    id: item.id,
    name: item.name,
    group: item.unitLabel ? `${item.typeName} · ${item.unitLabel}` : item.typeName,
  }));
  const standardNames = new Set(immediateItems.map((item) => normalizeText(item.name)));

  function updateLine(key: string, changes: Partial<EditableLine>) {
    setLines((current) => current.map((line) => (line.key === key ? recalc({ ...line, ...changes }) : line)));
  }

  return (
    <form action={savePurchaseAction} className="form">
      <input type="hidden" name="id" value={purchase?.id || ""} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="aba" value="registrar" />

      <fieldset className="form" disabled={disabled || !suppliers.length}>
        <div className="fields">
          <div className="field">
            <label htmlFor="purchase-date">Data</label>
            <input id="purchase-date" type="date" name="date" defaultValue={purchase?.purchase_date || defaultDate} required />
          </div>
          <div className="field">
            <label htmlFor="purchase-supplier">Fornecedor</label>
            <ItemPicker
              id="purchase-supplier"
              name="supplierId"
              options={supplierOptions}
              defaultId={purchase?.supplier_id}
              placeholder="Buscar fornecedor…"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="purchase-payment">Pagamento</label>
            <select id="purchase-payment" name="paymentMethodId" defaultValue={String(purchase?.payment_method_id || paymentMethods[0]?.id || "")} required>
              {paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="purchase-invoice">Nº da nota (opcional)</label>
            <input id="purchase-invoice" name="invoiceNumber" defaultValue={purchase?.invoice_number || ""} />
          </div>
          <div className="field wide">
            <label htmlFor="purchase-notes">Observação (opcional)</label>
            <input id="purchase-notes" name="notes" defaultValue={purchase?.notes || ""} />
          </div>
        </div>

        <div className="lines">
          {lines.map((line, index) => (
            <div className={`line ${line.destination}`} key={line.key}>
              <div className="field">
                <label>Destino</label>
                <select
                  name="lineDestination"
                  value={line.destination}
                  onChange={(event) =>
                    updateLine(line.key, { destination: event.target.value === "financial" ? "financial" : "inventory" })
                  }
                >
                  <option value="inventory">Estoque</option>
                  <option value="financial">Uso imediato</option>
                </select>
              </div>

              {line.destination === "inventory" ? (
                <>
                  <div className="field item-field">
                    <label>Produto {index + 1}</label>
                    <ItemPicker
                      name="lineItemId"
                      options={itemOptions}
                      defaultId={line.itemId}
                      placeholder="Buscar produto…"
                      required
                      onChange={(itemId) => updateLine(line.key, { itemId })}
                    />
                  </div>
                  <input type="hidden" name="lineDescription" value="" />
                  <input type="hidden" name="lineMovementTypeId" value="" />
                  <input type="hidden" name="lineSaveStandard" value="" />
                </>
              ) : (
                <>
                  <input type="hidden" name="lineItemId" value="" />
                  <div className="field">
                    <label>Tipo</label>
                    <select
                      name="lineMovementTypeId"
                      value={line.movementTypeId}
                      onChange={(event) => updateLine(line.key, { movementTypeId: event.target.value })}
                      required
                    >
                      {movementTypes.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field desc-field">
                    <label>Descrição {index + 1}</label>
                    <SuggestInput
                      name="lineDescription"
                      value={line.description}
                      options={standardOptions}
                      onChange={(description) => updateLine(line.key, { description })}
                      onPick={(option) => {
                        const item = immediateItems.find((row) => row.id === option.id);
                        if (item) updateLine(line.key, { description: item.name, movementTypeId: String(item.movementTypeId) });
                      }}
                      placeholder="Ex.: morango, topper, entrega"
                      required
                    />
                    <input type="hidden" name="lineSaveStandard" value={line.saveStandard ? "1" : ""} />
                  </div>
                </>
              )}

              <div className="field">
                <label>Quantidade</label>
                <input
                  type="number"
                  name="lineQuantity"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Preço por unidade</label>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  inputMode="decimal"
                  value={line.unitPrice}
                  onChange={(event) => updateLine(line.key, { unitPrice: event.target.value, anchor: "unit" })}
                  placeholder="R$"
                />
              </div>
              <div className="field">
                <label>Valor total</label>
                <input
                  type="number"
                  name="lineAmount"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={line.amount}
                  onChange={(event) => updateLine(line.key, { amount: event.target.value, anchor: "total" })}
                  placeholder="R$"
                  required
                />
              </div>
              <button
                className="btn btn-ghost remove"
                type="button"
                title="Remover linha"
                aria-label={`Remover linha ${index + 1}`}
                disabled={lines.length === 1}
                onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
              >
                <Icon name="x" size={16} />
              </button>
              {line.destination === "financial" && line.description.trim() ? (
                standardNames.has(normalizeText(line.description)) ? (
                  <span className="save-standard line-extra">
                    <Icon name="check" size={14} /> Item padrão: o gasto entra no acompanhamento da Reposição.
                  </span>
                ) : (
                  <label className="save-standard line-extra">
                    <input
                      type="checkbox"
                      checked={line.saveStandard}
                      onChange={(event) => updateLine(line.key, { saveStandard: event.target.checked })}
                    />
                    Salvar &quot;{line.description.trim()}&quot; como item padrão, para acompanhar gasto e preço
                  </label>
                )
              ) : null}
            </div>
          ))}
        </div>

        <div className="lines-foot">
          <div className="form-actions">
            <button className="btn" type="button" onClick={() => setLines((current) => [...current, newLine("inventory", defaultMovementType)])}>
              <Icon name="plus" /> Produto para o estoque
            </button>
            <button className="btn" type="button" onClick={() => setLines((current) => [...current, newLine("financial", defaultMovementType)])}>
              <Icon name="plus" /> Uso imediato ou despesa
            </button>
          </div>
          <div className="form-actions">
            <div className="field invoice-check">
              <label htmlFor="invoice-total">Total da nota (conferência)</label>
              <input
                id="invoice-total"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={invoiceTotal}
                onChange={(event) => setInvoiceTotal(event.target.value)}
                placeholder="opcional"
              />
            </div>
            {invoiceDiff === null ? null : Math.abs(invoiceDiff) < 0.01 ? (
              <span className="badge success">confere</span>
            ) : (
              <span className="badge warning">
                {invoiceDiff > 0 ? `faltam ${money(invoiceDiff)}` : `sobram ${money(-invoiceDiff)}`}
              </span>
            )}
            <span className="total-box">{money(total)}</span>
            <button className="btn btn-primary" type="submit">
              {purchase ? "Salvar alterações" : "Registrar compra"}
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
