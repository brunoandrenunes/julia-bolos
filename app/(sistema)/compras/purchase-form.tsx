"use client";

import { useState } from "react";
import { savePurchaseAction } from "@/app/actions";
import type {
  ItemRecord,
  MovementType,
  PaymentMethod,
  PurchaseRecord,
  SupplierRecord,
} from "@/lib/types";

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
};

type EditableLine = {
  key: string;
  destination: "inventory" | "financial";
  itemId: string;
  description: string;
  quantity: string;
  amount: string;
  movementTypeId: string;
};

let nextLineId = 1;

function newLine(
  destination: "inventory" | "financial",
  movementTypeId: number | undefined,
): EditableLine {
  return {
    key: `new-${nextLineId++}`,
    destination,
    itemId: "",
    description: "",
    quantity: "1",
    amount: "",
    movementTypeId: String(movementTypeId || ""),
  };
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
    movementTypeId: String(line.movement_type_id || movementTypeId || ""),
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
}: PurchaseFormProps) {
  const defaultMovementType = movementTypes.find((type) => type.name === "Insumos")?.id;
  const [lines, setLines] = useState<EditableLine[]>(() => initialLines(purchase, defaultMovementType));
  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);

  function updateLine(key: string, changes: Partial<EditableLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...changes } : line)),
    );
  }

  function removeLine(key: string) {
    setLines((current) => current.filter((line) => line.key !== key));
  }

  return (
    <form action={savePurchaseAction} className="grid">
      <input type="hidden" name="id" value={purchase?.id || ""} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />

      <fieldset className="form-fieldset" disabled={disabled || !suppliers.length}>
        <div className="form-grid three">
          <div className="field">
            <label htmlFor="purchase-date">Data da compra</label>
            <input
              id="purchase-date"
              type="date"
              name="date"
              defaultValue={purchase?.purchase_date || defaultDate}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="purchase-supplier">Fornecedor</label>
            <select
              id="purchase-supplier"
              name="supplierId"
              defaultValue={String(purchase?.supplier_id || suppliers[0]?.id || "")}
              required
            >
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="purchase-payment">Forma de pagamento</label>
            <select
              id="purchase-payment"
              name="paymentMethodId"
              defaultValue={String(purchase?.payment_method_id || paymentMethods[0]?.id || "")}
              required
            >
              {paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="purchase-invoice">Número da nota (opcional)</label>
            <input
              id="purchase-invoice"
              name="invoiceNumber"
              defaultValue={purchase?.invoice_number || ""}
              placeholder="Ex.: 12345"
            />
          </div>
          <div className="field full">
            <label htmlFor="purchase-notes">Observação geral</label>
            <textarea id="purchase-notes" name="notes" defaultValue={purchase?.notes || ""} />
          </div>
        </div>

        <div className="purchase-lines-header">
          <div>
            <h3>Itens da compra</h3>
            <p>O fornecedor e o pagamento acima valem para todos os itens.</p>
          </div>
          <strong>{money(total)}</strong>
        </div>

        <div className="purchase-lines">
          {lines.map((line, index) => (
            <div className={`purchase-line ${line.destination}`} key={line.key}>
              <div className="purchase-line-title">
                <strong>Item {index + 1}</strong>
                {lines.length > 1 ? (
                  <button
                    className="line-remove-button"
                    type="button"
                    onClick={() => removeLine(line.key)}
                  >
                    Remover
                  </button>
                ) : null}
              </div>

              <div className="form-grid three">
                <div className="field">
                  <label>Destino</label>
                  <select
                    name="lineDestination"
                    value={line.destination}
                    onChange={(event) =>
                      updateLine(line.key, {
                        destination: event.target.value === "financial" ? "financial" : "inventory",
                      })
                    }
                  >
                    <option value="inventory">Estoque</option>
                    <option value="financial">Financeiro imediato</option>
                  </select>
                </div>

                {line.destination === "inventory" ? (
                  <>
                    <div className="field full-mobile-span">
                      <label>Produto de estoque</label>
                      <select
                        name="lineItemId"
                        value={line.itemId}
                        onChange={(event) => updateLine(line.key, { itemId: event.target.value })}
                        required
                      >
                        <option value="">Selecione o produto</option>
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <input type="hidden" name="lineDescription" value="" />
                    <input type="hidden" name="lineMovementTypeId" value="" />
                  </>
                ) : (
                  <>
                    <input type="hidden" name="lineItemId" value="" />
                    <div className="field">
                      <label>Tipo financeiro</label>
                      <select
                        name="lineMovementTypeId"
                        value={line.movementTypeId}
                        onChange={(event) =>
                          updateLine(line.key, { movementTypeId: event.target.value })
                        }
                        required
                      >
                        {movementTypes.map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field full">
                      <label>Descrição</label>
                      <input
                        name="lineDescription"
                        value={line.description}
                        onChange={(event) =>
                          updateLine(line.key, { description: event.target.value })
                        }
                        placeholder="Ex.: Morango, topper ou entrega"
                        required
                      />
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
                    value={line.quantity}
                    onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label>Valor total do item</label>
                  <input
                    type="number"
                    name="lineAmount"
                    min="0.01"
                    step="0.01"
                    value={line.amount}
                    onChange={(event) => updateLine(line.key, { amount: event.target.value })}
                    required
                  />
                </div>
                <div className="field purchase-unit-price">
                  <label>Preço por unidade</label>
                  <div>
                    {Number(line.quantity) > 0 && Number(line.amount) > 0
                      ? money(Number(line.amount) / Number(line.quantity))
                      : "-"}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="purchase-add-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => setLines((current) => [...current, newLine("inventory", defaultMovementType)])}
          >
            + Item para estoque
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setLines((current) => [...current, newLine("financial", defaultMovementType)])}
          >
            + Item de consumo ou despesa
          </button>
        </div>

        <div className="form-actions purchase-submit-row">
          <button className="button" type="submit">
            {purchase ? "Salvar alterações da compra" : "Registrar compra completa"}
          </button>
          <span>Total conferido: {money(total)}</span>
        </div>
      </fieldset>
    </form>
  );
}

export function ConfirmSubmitButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      className="danger-button"
      type="submit"
      onClick={(event) => {
        if (!window.confirm("Confirma a exclusão? Os lançamentos vinculados também serão removidos.")) {
          event.preventDefault();
        }
      }}
    >
      {children}
    </button>
  );
}
