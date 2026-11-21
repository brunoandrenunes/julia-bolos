"use client";

import jsQR from "jsqr";
import { useState, useTransition } from "react";
import { readInvoiceAction, savePurchaseAction } from "@/app/actions";
import { ItemPicker, SuggestInput } from "@/components/client-ui";
import { Icon } from "@/components/ui";
import type { InvoiceSource } from "@/lib/data";
import type { InvoiceDraft } from "@/lib/nfce";
import type { ItemRecord, MovementType, PaymentMethod, PurchaseRecord, SupplierRecord } from "@/lib/types";
import type { ImmediateItem } from "@/lib/uso-imediato";
import { normalizeText } from "@/lib/utils";

type PurchaseFormProps = {
  year: number;
  month: number;
  defaultDate: string;
  defaultPaymentId?: number;
  disabled: boolean;
  suppliers: SupplierRecord[];
  paymentMethods: PaymentMethod[];
  movementTypes: MovementType[];
  items: ItemRecord[];
  purchase?: PurchaseRecord | null;
  immediateItems: ImmediateItem[];
};

// "personal" = itens da casa (vira Retirada); "skip" = não importar (só para notas importadas).
type Destination = "inventory" | "financial" | "personal" | "skip";

type EditableLine = {
  key: string;
  destination: Destination;
  itemId: string;
  description: string;
  quantity: string;
  amount: string;
  unitPrice: string;
  // Qual valor a pessoa digitou por último: o outro é calculado.
  anchor: "unit" | "total";
  movementTypeId: string;
  saveStandard: boolean;
  source?: InvoiceDraft["lines"][number]["source"];
  origin?: "aprendido" | "palpite" | null;
};

let nextLineId = 1;

function newLine(destination: Destination, movementTypeId?: number): EditableLine {
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

function draftLines(draft: InvoiceDraft, insumosId?: number, retiradaId?: number): EditableLine[] {
  return draft.lines.map((line) => ({
    key: `nota-${nextLineId++}`,
    destination: line.destination,
    itemId: line.itemId ? String(line.itemId) : "",
    description: line.description,
    quantity: String(line.quantity),
    amount: String(line.source.total),
    unitPrice: line.quantity ? String(round(line.source.total / line.quantity, 4)) : "",
    anchor: "total",
    movementTypeId: String(line.movementTypeId || (line.destination === "personal" ? retiradaId : insumosId) || ""),
    saveStandard: false,
    source: line.source,
    origin: line.origin,
  }));
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
const qtyText = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);

// Lê o QR Code de uma foto no próprio navegador (tenta alguns tamanhos).
async function qrFromImage(file: File) {
  const bitmap = await createImageBitmap(file);
  for (const max of [1200, 1800, 900, 2600]) {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" });
    if (found?.data) return found.data;
  }
  return null;
}

function InvoiceImport({ onDraft }: { onDraft: (draft: InvoiceDraft) => void }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function read() {
    setError("");
    startTransition(async () => {
      const data = new FormData();
      try {
        if (file && file.type.startsWith("image/")) {
          const decoded = await qrFromImage(file);
          if (!decoded) {
            setError("Não consegui ler o QR Code nesta foto. Tire outra mais de perto, com boa luz, ou cole o link.");
            return;
          }
          data.set("texto", decoded);
        } else if (file) {
          data.set("arquivo", file);
        } else {
          data.set("texto", text);
        }
      } catch {
        setError("Não consegui abrir este arquivo.");
        return;
      }
      const result = await readInvoiceAction(data);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (result.draft.duplicate) {
        setError(`Esta nota já foi registrada (compra de ${result.draft.duplicate.date.split("-").reverse().join("/")}).`);
        return;
      }
      setText("");
      setFile(null);
      onDraft(result.draft);
    });
  }

  return (
    <div className="invoice-import">
      <div className="invoice-import-head">
        <strong>Importar cupom do mercado</strong>
        <span className="muted">Foto ou PDF do cupom (o sistema lê o QR Code), ou cole o link do QR Code.</span>
      </div>
      <div className="invoice-import-row">
        <input
          aria-label="Link do QR Code"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Link do QR Code (www.fazenda.pr.gov.br/nfce/qrcode?p=…)"
          disabled={pending || Boolean(file)}
        />
        <label className="btn file-btn">
          <Icon name="download" size={16} /> {file ? file.name.slice(0, 24) : "Foto ou PDF"}
          <input type="file" accept="image/*,application/pdf" hidden onChange={(event) => setFile(event.target.files?.[0] || null)} />
        </label>
        <button className="btn btn-primary" type="button" onClick={read} disabled={pending || (!text.trim() && !file)}>
          {pending ? "Lendo…" : "Ler nota"}
        </button>
      </div>
      {error ? <p className="line-note warn" style={{ margin: 0 }}>{error}</p> : null}
    </div>
  );
}

export function PurchaseForm(props: PurchaseFormProps) {
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [version, setVersion] = useState(0);
  return (
    <>
      {!props.purchase && !props.disabled ? (
        <InvoiceImport
          onDraft={(next) => {
            setDraft(next);
            setVersion((current) => current + 1);
          }}
        />
      ) : null}
      <PurchaseFormInner key={version} {...props} draft={draft} onClearDraft={() => { setDraft(null); setVersion((current) => current + 1); }} />
    </>
  );
}

function PurchaseFormInner({
  year,
  month,
  defaultDate,
  defaultPaymentId,
  disabled,
  suppliers,
  paymentMethods,
  movementTypes,
  items,
  purchase,
  immediateItems,
  draft,
  onClearDraft,
}: PurchaseFormProps & { draft: InvoiceDraft | null; onClearDraft: () => void }) {
  const insumosId = movementTypes.find((type) => type.name === "Insumos")?.id;
  const retiradaId = movementTypes.find((type) => type.name === "Retirada")?.id;
  const financialTypes = movementTypes.filter((type) => type.name !== "Retirada");
  const [lines, setLines] = useState<EditableLine[]>(() => (draft ? draftLines(draft, insumosId, retiradaId) : initialLines(purchase, insumosId)));
  const [invoiceTotal, setInvoiceTotal] = useState(draft ? String(draft.total) : "");
  const [supplierChosen, setSupplierChosen] = useState(Boolean(draft?.supplierId));
  const included = lines.filter((line) => line.destination !== "skip");
  const skippedLines = lines.filter((line) => line.destination === "skip");
  const total = round(included.reduce((sum, line) => sum + (Number(line.amount) || 0), 0), 2);
  const skippedTotal = round(skippedLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0), 2);
  const invoiceDiff = invoiceTotal === "" ? null : round(Number(invoiceTotal) - total - skippedTotal, 2);
  const itemOptions = items.map((item) => ({ id: item.id, name: item.name, group: item.category_name }));
  const supplierOptions = suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }));
  const standardOptions = immediateItems.map((item) => ({
    id: item.id,
    name: item.name,
    group: item.unitLabel ? `${item.typeName} · ${item.unitLabel}` : item.typeName,
  }));
  const standardNames = new Set(immediateItems.map((item) => normalizeText(item.name)));
  const sourceOf = (line: EditableLine): InvoiceSource | null =>
    line.source ? { key: line.source.key, description: line.source.description, qty: line.source.qty, destination: line.destination } : null;

  function updateLine(key: string, changes: Partial<EditableLine>) {
    setLines((current) => current.map((line) => (line.key === key ? recalc({ ...line, ...changes }) : line)));
  }

  function changeDestination(line: EditableLine, destination: Destination) {
    const changes: Partial<EditableLine> = { destination };
    if (destination === "personal") changes.movementTypeId = String(retiradaId || "");
    if (destination === "financial" && (!line.movementTypeId || line.movementTypeId === String(retiradaId))) changes.movementTypeId = String(insumosId || "");
    if ((destination === "financial" || destination === "personal") && !line.description && line.source) changes.description = line.source.description;
    // Ao trocar de estoque para outro destino, a quantidade volta a ser a da nota.
    if (destination !== "inventory" && line.source) changes.quantity = String(line.source.qty);
    updateLine(line.key, changes);
  }

  return (
    <form action={savePurchaseAction} className="form">
      <input type="hidden" name="id" value={purchase?.id || ""} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="aba" value="registrar" />
      {draft ? (
        <>
          <input type="hidden" name="accessKey" value={draft.key} />
          <input type="hidden" name="supplierDocument" value={draft.supplierDocument} />
          <input type="hidden" name="newSupplierName" value={supplierChosen ? "" : draft.supplierName} />
          <input type="hidden" name="skippedSources" value={JSON.stringify(skippedLines.map(sourceOf).filter(Boolean))} />
        </>
      ) : null}

      {draft ? (
        <div className="alert info" role="status">
          <Icon name="info" />
          <div className="alert-body">
            <strong>Cupom lido: {draft.supplierName}</strong>
            {`${draft.lines.length} produtos · ${money(draft.total)} · ${draft.paymentLabel || "pagamento não informado"}. `}
            Confira o destino de cada produto: <b>Estoque</b>, <b>Uso imediato</b>, <b>Casa (retirada)</b> para o que é da casa, ou
            <b> Não importar</b>. Na próxima nota deste mercado, o sistema já repete as suas escolhas.
          </div>
          <div className="alert-action">
            <button className="btn btn-sm btn-ghost" type="button" onClick={onClearDraft}>Descartar</button>
          </div>
        </div>
      ) : null}

      <fieldset className="form" disabled={disabled || !suppliers.length}>
        <div className="fields">
          <div className="field">
            <label htmlFor="purchase-date">Data</label>
            <input id="purchase-date" type="date" name="date" defaultValue={purchase?.purchase_date || draft?.date || defaultDate} required />
          </div>
          <div className="field">
            <label htmlFor="purchase-supplier">Fornecedor</label>
            <ItemPicker
              id="purchase-supplier"
              name="supplierId"
              options={supplierOptions}
              defaultId={purchase?.supplier_id || draft?.supplierId}
              placeholder={draft && !draft.supplierId ? "Escolha, ou deixe vazio para cadastrar" : "Buscar fornecedor…"}
              required={!draft || Boolean(draft.supplierId)}
              onChange={(id) => setSupplierChosen(Boolean(id))}
            />
          </div>
          <div className="field">
            <label htmlFor="purchase-payment">Pagamento</label>
            <select id="purchase-payment" name="paymentMethodId" defaultValue={String(purchase?.payment_method_id || draft?.paymentMethodId || defaultPaymentId || paymentMethods[0]?.id || "")} required>
              {paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="purchase-invoice">Nº da nota (opcional)</label>
            <input id="purchase-invoice" name="invoiceNumber" defaultValue={purchase?.invoice_number || draft?.invoiceNumber || ""} />
          </div>
          {draft && !draft.supplierId ? (
            <p className="line-note field wide" style={{ margin: 0 }}>
              {supplierChosen
                ? `O CNPJ ${draft.supplierDocument} fica guardado neste fornecedor; na próxima nota ele é reconhecido sozinho.`
                : `Mercado novo: "${draft.supplierName}" (CNPJ ${draft.supplierDocument}) será cadastrado. Se já existe com outro nome (ex.: Super Polo), escolha-o no campo Fornecedor.`}
            </p>
          ) : null}
          <div className="field wide">
            <label htmlFor="purchase-notes">Observação (opcional)</label>
            <input id="purchase-notes" name="notes" defaultValue={purchase?.notes || (draft ? "Cupom importado pelo QR Code" : "")} />
          </div>
        </div>

        <div className="lines">
          {lines.map((line, index) => {
            const skip = line.destination === "skip";
            const asFinancial = line.destination === "financial" || line.destination === "personal";
            const named = (name: string) => (skip ? undefined : name); // linha "não importar" não é enviada
            return (
              <div className={`line ${asFinancial ? "financial" : line.destination === "inventory" ? "inventory" : "financial"}${skip ? " skipped" : ""}`} key={line.key}>
                <div className="field">
                  <label>Destino</label>
                  <select value={line.destination} onChange={(event) => changeDestination(line, event.target.value as Destination)}>
                    <option value="inventory">Estoque</option>
                    <option value="financial">Uso imediato</option>
                    <option value="personal">Casa (retirada)</option>
                    {line.source ? <option value="skip">Não importar</option> : null}
                  </select>
                  {!skip ? <input type="hidden" name="lineDestination" value={line.destination === "inventory" ? "inventory" : "financial"} /> : null}
                  {!skip ? <input type="hidden" name="lineSource" value={line.source ? JSON.stringify(sourceOf(line)) : ""} /> : null}
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
                    {!skip ? <input type="hidden" name="lineItemId" value="" /> : null}
                    {line.destination === "personal" ? (
                      <div className="field">
                        <label>Tipo</label>
                        <input value="Retirada (casa)" readOnly tabIndex={-1} />
                        <input type="hidden" name="lineMovementTypeId" value={line.movementTypeId} />
                      </div>
                    ) : (
                      <div className="field">
                        <label>Tipo</label>
                        <select
                          name={named("lineMovementTypeId")}
                          value={line.movementTypeId}
                          onChange={(event) => updateLine(line.key, { movementTypeId: event.target.value })}
                          required={!skip}
                          disabled={skip}
                        >
                          {financialTypes.map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="field desc-field">
                      <label>Descrição {index + 1}</label>
                      {skip ? (
                        <input value={line.source?.description || line.description} readOnly tabIndex={-1} />
                      ) : (
                        <SuggestInput
                          name="lineDescription"
                          value={line.description}
                          options={line.destination === "personal" ? [] : standardOptions}
                          onChange={(description) => updateLine(line.key, { description })}
                          onPick={(option) => {
                            const item = immediateItems.find((row) => row.id === option.id);
                            if (item) updateLine(line.key, { description: item.name, movementTypeId: String(item.movementTypeId) });
                          }}
                          placeholder="Ex.: morango, topper, entrega"
                          required
                        />
                      )}
                      {!skip ? <input type="hidden" name="lineSaveStandard" value={line.saveStandard && line.destination === "financial" ? "1" : ""} /> : null}
                    </div>
                  </>
                )}

                <div className="field">
                  <label>Quantidade</label>
                  <input
                    type="number"
                    name={named("lineQuantity")}
                    min="0.001"
                    step="any"
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                    required={!skip}
                    disabled={skip}
                  />
                </div>
                <div className="field">
                  <label>Preço por unidade</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={line.unitPrice}
                    onChange={(event) => updateLine(line.key, { unitPrice: event.target.value, anchor: "unit" })}
                    placeholder="R$"
                    disabled={skip}
                  />
                </div>
                <div className="field">
                  <label>Valor total</label>
                  <input
                    type="number"
                    name={named("lineAmount")}
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={line.amount}
                    onChange={(event) => updateLine(line.key, { amount: event.target.value, anchor: "total" })}
                    placeholder="R$"
                    required={!skip}
                    disabled={skip}
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
                {line.source ? (
                  <span className={`line-extra line-note${line.origin === "palpite" ? " warn" : ""}`}>
                    Nota: {line.source.description} · {qtyText(line.source.qty)} {line.source.unit} × {money(line.source.unitPrice)} = {money(line.source.total)}
                    {line.origin === "aprendido" ? " · como da última vez" : line.origin === "palpite" ? " · palpite pelo nome: confira o produto" : ""}
                    {line.destination === "inventory" && line.source.unit !== "UN" ? " · na quantidade, use a unidade do item do sistema" : ""}
                    {line.destination === "inventory" ? " · quantidade = unidades do item no sistema (ex.: 1 dúzia = 12 ovos)" : ""}
                  </span>
                ) : null}
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
            );
          })}
        </div>

        <div className="lines-foot">
          <div className="form-actions">
            <button className="btn" type="button" onClick={() => setLines((current) => [...current, newLine("inventory", insumosId)])}>
              <Icon name="plus" /> Produto para o estoque
            </button>
            <button className="btn" type="button" onClick={() => setLines((current) => [...current, newLine("financial", insumosId)])}>
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
            {skippedTotal > 0 ? <span className="muted">não importados {money(skippedTotal)}</span> : null}
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
