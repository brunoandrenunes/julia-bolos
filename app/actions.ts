"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import {
  createOrUpdateFinancialTransaction,
  createOrUpdateInventoryEntry,
  createOrUpdateInventoryUsage,
  createOrUpdateItem,
  createOrUpdatePurchase,
  createOrUpdateSupplier,
  createOrUpdateTransfer,
  deactivateItem,
  type InvoiceSource,
  deletePurchase,
  deleteFinancialTransaction,
  deleteInventoryEntry,
  deleteInventoryUsage,
  deleteTransfer,
  reactivateItem,
  setSupplierActive,
  setPeriodClosed,
} from "@/lib/data";
import { applyReplenishment, registerPhysicalCount } from "@/lib/analise";
import { readInvoice, type InvoiceDraft } from "@/lib/nfce";
import { applyStatementActions, importStatement, reopenStatementLine, type StatementAction } from "@/lib/extrato";
import { duplicateProduct, saveProduct, setIndirectDefault, setProductActive, type ProductInput } from "@/lib/custos";
import { linkDescriptions, saveImmediateItem, setImmediateItemActive, unlinkImmediateItem } from "@/lib/uso-imediato";
import { buildPeriodHref, clampNumber, cleanText, currentYearMonth } from "@/lib/utils";

// Depois de gravar, volta para a mesma tela, mês e aba de onde o formulário veio.
function getPeriodTarget(formData: FormData, pathname: string, extras?: Record<string, string | number>) {
  const now = currentYearMonth();
  const year = Number(formData.get("year")) || now.year;
  const month = Number(formData.get("month")) || now.month;
  const aba = cleanText(formData.get("aba"));
  return buildPeriodHref(pathname, year, month, { ...(aba ? { aba } : {}), ...extras });
}

async function runPeriodMutation(
  formData: FormData,
  pathname: string,
  mutation: () => Promise<unknown>,
) {
  try {
    await mutation();
  } catch (error) {
    // Sessão vencida: deixa o redirecionamento para o login seguir.
    unstable_rethrow(error);
    const raw = error instanceof Error ? error.message : "";
    const message = /duplicate key|unique/i.test(raw)
      ? "Já existe um cadastro com esse nome."
      : raw || "Não foi possível concluir a operação.";
    redirect(getPeriodTarget(formData, pathname, { error: message }));
  }
}

function revalidateAll() {
  revalidatePath("/", "layout");
}

function done(formData: FormData, pathname: string, notice: string): never {
  revalidateAll();
  redirect(getPeriodTarget(formData, pathname, { notice }));
}

export async function saveItemAction(formData: FormData) {
  const id = Number(formData.get("id")) || undefined;
  await runPeriodMutation(formData, "/estoque", () =>
    createOrUpdateItem({
      id,
      name: cleanText(formData.get("name")),
      categoryName: cleanText(formData.get("categoryName")) || "Outros",
      unitSize: formData.get("unitSize") ? clampNumber(formData.get("unitSize"), 0) : null,
      referencePrice: formData.get("referencePrice")
        ? clampNumber(formData.get("referencePrice"), 0)
        : null,
      pricePerKg: formData.get("pricePerKg") ? clampNumber(formData.get("pricePerKg"), 0) : null,
      lowStockThreshold: clampNumber(formData.get("lowStockThreshold"), 0),
      notes: cleanText(formData.get("notes")),
      contentQty: formData.get("contentQty") ? clampNumber(formData.get("contentQty"), 0) : null,
      contentUnit: cleanText(formData.get("contentUnit")) || null,
    }),
  );
  done(formData, "/estoque", id ? "Item atualizado." : "Item cadastrado.");
}

export async function deleteItemAction(formData: FormData) {
  await runPeriodMutation(formData, "/estoque", () => deactivateItem(Number(formData.get("id"))));
  done(formData, "/estoque", "Item arquivado. O histórico continua preservado.");
}

export async function reactivateItemAction(formData: FormData) {
  await runPeriodMutation(formData, "/estoque", () => reactivateItem(Number(formData.get("id"))));
  done(formData, "/estoque", "Item reativado.");
}

export async function saveInventoryEntryAction(formData: FormData) {
  await runPeriodMutation(formData, "/estoque", () =>
    createOrUpdateInventoryEntry({
      id: Number(formData.get("id")) || undefined,
      date: cleanText(formData.get("date")),
      paymentMethodId: Number(formData.get("paymentMethodId")),
      itemId: Number(formData.get("itemId")),
      quantity: clampNumber(formData.get("quantity"), 0),
      totalAmount: clampNumber(formData.get("totalAmount"), 0),
      notes: cleanText(formData.get("notes")),
    }),
  );
  done(formData, "/estoque", "Entrada atualizada.");
}

export async function deleteInventoryEntryAction(formData: FormData) {
  await runPeriodMutation(formData, "/estoque", () => deleteInventoryEntry(Number(formData.get("id"))));
  done(formData, "/estoque", "Entrada excluída.");
}

export async function saveSupplierAction(formData: FormData) {
  await runPeriodMutation(formData, "/compras", () =>
    createOrUpdateSupplier({
      id: Number(formData.get("id")) || undefined,
      name: cleanText(formData.get("name")),
      contact: cleanText(formData.get("contact")),
      notes: cleanText(formData.get("notes")),
    }),
  );
  done(formData, "/compras", "Fornecedor salvo.");
}

export async function archiveSupplierAction(formData: FormData) {
  await runPeriodMutation(formData, "/compras", () => setSupplierActive(Number(formData.get("id")), false));
  done(formData, "/compras", "Fornecedor arquivado.");
}

export async function reactivateSupplierAction(formData: FormData) {
  await runPeriodMutation(formData, "/compras", () => setSupplierActive(Number(formData.get("id")), true));
  done(formData, "/compras", "Fornecedor reativado.");
}

export async function savePurchaseAction(formData: FormData) {
  const destinations = formData.getAll("lineDestination");
  const itemIds = formData.getAll("lineItemId");
  const descriptions = formData.getAll("lineDescription");
  const quantities = formData.getAll("lineQuantity");
  const amounts = formData.getAll("lineAmount");
  const movementTypeIds = formData.getAll("lineMovementTypeId");
  const saveStandard = formData.getAll("lineSaveStandard");
  const lineSources = formData.getAll("lineSource");
  const parseSource = (value: FormDataEntryValue | undefined): InvoiceSource | null => {
    try {
      return value ? (JSON.parse(String(value)) as InvoiceSource) : null;
    } catch {
      return null;
    }
  };
  let skipped: InvoiceSource[] = [];
  try {
    skipped = JSON.parse(String(formData.get("skippedSources") || "[]")) as InvoiceSource[];
  } catch {
    skipped = [];
  }
  const id = Number(formData.get("id")) || undefined;

  await runPeriodMutation(formData, "/compras", () =>
    createOrUpdatePurchase({
      id,
      date: cleanText(formData.get("date")),
      supplierId: Number(formData.get("supplierId")) || 0,
      accessKey: cleanText(formData.get("accessKey")) || undefined,
      supplierDocument: cleanText(formData.get("supplierDocument")) || undefined,
      newSupplierName: cleanText(formData.get("newSupplierName")) || undefined,
      sources: destinations.map((_, index) => parseSource(lineSources[index])),
      skipped,
      paymentMethodId: Number(formData.get("paymentMethodId")),
      invoiceNumber: cleanText(formData.get("invoiceNumber")),
      notes: cleanText(formData.get("notes")),
      lines: destinations.map((destination, index) => ({
        destination:
          String(destination) === "financial" ? ("financial" as const) : ("inventory" as const),
        itemId: Number(itemIds[index]) || null,
        description: cleanText(descriptions[index]),
        quantity: clampNumber(quantities[index], 0),
        totalAmount: clampNumber(amounts[index], 0),
        movementTypeId: Number(movementTypeIds[index]) || null,
        saveAsStandard: String(saveStandard[index] || "") === "1",
      })),
    }),
  );

  // Edição: mostra o histórico do mês. Compra nova: volta ao formulário vazio para a próxima nota,
  // com a mesma data e forma de pagamento.
  if (id) {
    formData.set("aba", "historico");
    done(formData, "/compras", "Compra atualizada. Estoque e financeiro acompanharam.");
  }
  formData.set("aba", "registrar");
  revalidateAll();
  redirect(
    getPeriodTarget(formData, "/compras", {
      notice: "Compra registrada. Estoque e financeiro já foram atualizados. Pode lançar a próxima nota.",
      ultData: cleanText(formData.get("date")),
      ultPagamento: cleanText(formData.get("paymentMethodId")),
    }),
  );
}

export async function deletePurchaseAction(formData: FormData) {
  await runPeriodMutation(formData, "/compras", () => deletePurchase(Number(formData.get("id"))));
  done(formData, "/compras", "Compra excluída com os lançamentos vinculados.");
}

export async function saveInventoryUsageAction(formData: FormData) {
  const id = Number(formData.get("id")) || undefined;
  await runPeriodMutation(formData, "/estoque", () =>
    createOrUpdateInventoryUsage({
      id,
      date: cleanText(formData.get("date")),
      itemId: Number(formData.get("itemId")),
      quantity: clampNumber(formData.get("quantity"), 0),
      notes: cleanText(formData.get("notes")),
    }),
  );
  done(formData, "/estoque", id ? "Baixa atualizada." : "Baixa registrada.");
}

export async function deleteInventoryUsageAction(formData: FormData) {
  await runPeriodMutation(formData, "/estoque", () => deleteInventoryUsage(Number(formData.get("id"))));
  done(formData, "/estoque", "Baixa excluída.");
}

export async function saveFinancialTransactionAction(formData: FormData) {
  const id = Number(formData.get("id")) || undefined;
  await runPeriodMutation(formData, "/financeiro", () =>
    createOrUpdateFinancialTransaction({
      id,
      date: cleanText(formData.get("date")),
      paymentMethodId: Number(formData.get("paymentMethodId")),
      movementTypeId: Number(formData.get("movementTypeId")),
      description: cleanText(formData.get("description")),
      amount: clampNumber(formData.get("amount"), 0),
      itemId: Number(formData.get("itemId")) || null,
      notes: cleanText(formData.get("notes")),
      saveAsStandard: formData.get("saveStandard") === "1",
    }),
  );
  if (id) done(formData, "/financeiro", "Lançamento atualizado.");
  // Lançamento novo: volta com o formulário pronto para o próximo, no mesmo tipo, data e conta.
  revalidateAll();
  redirect(
    getPeriodTarget(formData, "/financeiro", {
      notice: `Lançamento registrado: ${cleanText(formData.get("description"))}. Pode lançar o próximo.`,
      ultTipo: cleanText(formData.get("movementTypeId")),
      ultData: cleanText(formData.get("date")),
      ultConta: cleanText(formData.get("paymentMethodId")),
    }),
  );
}

export async function deleteFinancialTransactionAction(formData: FormData) {
  await runPeriodMutation(formData, "/financeiro", () =>
    deleteFinancialTransaction(Number(formData.get("id"))),
  );
  done(formData, "/financeiro", "Lançamento excluído.");
}

export async function saveTransferAction(formData: FormData) {
  const id = Number(formData.get("id")) || undefined;
  await runPeriodMutation(formData, "/financeiro", () =>
    createOrUpdateTransfer({
      id,
      date: cleanText(formData.get("date")),
      fromPaymentMethodId: Number(formData.get("fromPaymentMethodId")),
      toPaymentMethodId: Number(formData.get("toPaymentMethodId")),
      amount: clampNumber(formData.get("amount"), 0),
      description: cleanText(formData.get("description")),
      notes: cleanText(formData.get("notes")),
    }),
  );
  done(formData, "/financeiro", id ? "Transferência atualizada." : "Transferência registrada.");
}

export async function deleteTransferAction(formData: FormData) {
  await runPeriodMutation(formData, "/financeiro", () => deleteTransfer(Number(formData.get("id"))));
  done(formData, "/financeiro", "Transferência excluída.");
}

export async function closePeriodAction(formData: FormData) {
  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  await runPeriodMutation(formData, "/financeiro", () => setPeriodClosed({ year, month, closed: true }));
  done(formData, "/financeiro", "Mês fechado e protegido.");
}

export async function reopenPeriodAction(formData: FormData) {
  if (formData.get("confirmReopen") !== "yes") {
    redirect(
      getPeriodTarget(formData, "/financeiro", {
        error: "Marque a confirmação antes de reabrir o mês.",
      }),
    );
  }

  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  await runPeriodMutation(formData, "/financeiro", () => setPeriodClosed({ year, month, closed: false }));
  done(formData, "/financeiro", "Mês reaberto para ajustes. Lembre de fechar de novo depois.");
}

export async function registerCountAction(formData: FormData) {
  const counts: { itemId: number; counted: number }[] = [];
  formData.forEach((value, key) => {
    if (key.startsWith("contado_") && `${value}`.trim() !== "") {
      counts.push({ itemId: Number(key.slice(8)), counted: clampNumber(String(value).replace(",", "."), -1) });
    }
  });
  if (!counts.length) {
    redirect(getPeriodTarget(formData, "/estoque", { error: "Informe a quantidade contada de pelo menos um item." }));
  }
  let result = { created: 0, surplus: [] as string[] };
  await runPeriodMutation(formData, "/estoque", async () => {
    result = await registerPhysicalCount({ date: cleanText(formData.get("date")), counts });
  });
  formData.set("aba", "contagem");
  const surplus = result.surplus.length
    ? ` Atenção: ${result.surplus.length} item(ns) com mais do que o sistema esperava — confira se falta lançar alguma compra: ${result.surplus.join(", ")}.`
    : "";
  done(formData, "/estoque", `Contagem lançada: ${result.created} baixa(s) registrada(s).${surplus}`);
}

export async function applyReplenishmentAction(formData: FormData) {
  const ids = formData.getAll("aplicar").map(Number).filter(Boolean);
  if (!ids.length) {
    redirect(getPeriodTarget(formData, "/reposicao", { error: "Marque pelo menos um item para salvar." }));
  }
  const rows = ids.map((itemId) => ({
    itemId,
    min: clampNumber(formData.get(`min_${itemId}`), -1),
    target: clampNumber(formData.get(`alvo_${itemId}`), -1),
    cycle: Number(formData.get(`ciclo_${itemId}`)) || null,
  }));
  await runPeriodMutation(formData, "/reposicao", () => applyReplenishment(rows));
  done(formData, "/reposicao", `Mínimo e estoque-alvo salvos para ${rows.length} item(ns).`);
}

/* ---------- Itens padrão de uso imediato (Reposição › Uso imediato) ---------- */

export async function saveImmediateItemAction(formData: FormData) {
  const id = Number(formData.get("id")) || undefined;
  await runPeriodMutation(formData, "/reposicao", () =>
    saveImmediateItem({
      id,
      name: cleanText(formData.get("name")),
      movementTypeId: Number(formData.get("movementTypeId")),
      unitLabel: cleanText(formData.get("unitLabel")),
      notes: cleanText(formData.get("notes")),
    }),
  );
  done(formData, "/reposicao", id ? "Item padrão atualizado." : "Item padrão cadastrado.");
}

export async function archiveImmediateItemAction(formData: FormData) {
  await runPeriodMutation(formData, "/reposicao", () => setImmediateItemActive(Number(formData.get("id")), false));
  done(formData, "/reposicao", "Item padrão arquivado. O histórico continua.");
}

export async function reactivateImmediateItemAction(formData: FormData) {
  await runPeriodMutation(formData, "/reposicao", () => setImmediateItemActive(Number(formData.get("id")), true));
  done(formData, "/reposicao", "Item padrão reativado.");
}

export async function linkDescriptionsAction(formData: FormData) {
  let linked = 0;
  const choice = cleanText(formData.get("itemId"));
  await runPeriodMutation(formData, "/reposicao", async () => {
    linked = await linkDescriptions({
      variants: formData.getAll("variant").map(String),
      typeName: cleanText(formData.get("typeName")),
      itemId: choice === "novo" ? null : Number(choice) || null,
      newName: cleanText(formData.get("newName")),
    });
  });
  done(formData, "/reposicao", `${linked} lançamento(s) vinculado(s) ao item padrão.`);
}

export async function unlinkImmediateItemAction(formData: FormData) {
  let count = 0;
  await runPeriodMutation(formData, "/reposicao", async () => {
    count = await unlinkImmediateItem(Number(formData.get("id")));
  });
  done(formData, "/reposicao", `${count} lançamento(s) desvinculado(s). Eles voltam para a lista "sem item padrão".`);
}

/* ---------- Custos dos produtos (fichas técnicas) ---------- */

function custosHref(extra: Record<string, string | number>) {
  const query = new URLSearchParams(Object.entries(extra).map(([key, value]) => [key, String(value)]));
  return `/custos?${query.toString()}`;
}

async function runCostMutation<T>(back: Record<string, string | number>, mutation: () => Promise<T>) {
  try {
    return await mutation();
  } catch (error) {
    unstable_rethrow(error);
    const raw = error instanceof Error ? error.message : "";
    const message = /duplicate key|unique/i.test(raw)
      ? "Já existe um produto com esse nome."
      : raw || "Não foi possível concluir a operação.";
    redirect(custosHref({ ...back, error: message }));
  }
}

function costDone(extra: Record<string, string | number>): never {
  revalidateAll();
  redirect(custosHref(extra));
}

export async function saveProductAction(formData: FormData) {
  let input: ProductInput;
  try {
    input = JSON.parse(String(formData.get("payload") || "{}")) as ProductInput;
  } catch {
    redirect(custosHref({ error: "Não foi possível ler a ficha. Tente de novo." }));
  }
  const back = { produto: input.id || "novo" };
  const id = await runCostMutation(back, () => saveProduct(input));
  costDone({ produto: id, notice: input.id ? "Ficha salva. Custos recalculados." : "Produto cadastrado." });
}

export async function duplicateProductAction(formData: FormData) {
  const source = Number(formData.get("id"));
  const id = await runCostMutation({ produto: source }, () => duplicateProduct(source));
  costDone({ produto: id, notice: "Cópia criada. Ajuste o nome e o que for diferente." });
}

export async function archiveProductAction(formData: FormData) {
  const id = Number(formData.get("id"));
  await runCostMutation({ produto: id }, () => setProductActive(id, false));
  costDone({ notice: "Produto arquivado." });
}

export async function reactivateProductAction(formData: FormData) {
  const id = Number(formData.get("id"));
  await runCostMutation({ produto: id }, () => setProductActive(id, true));
  costDone({ produto: id, notice: "Produto reativado." });
}

export async function saveIndirectDefaultAction(formData: FormData) {
  const pct = clampNumber(formData.get("indirectPct"), -1) / 100;
  await runCostMutation({}, () => setIndirectDefault(pct));
  costDone({ notice: "Percentual padrão de custos indiretos atualizado." });
}

/* ---------- Extrato bancário (Financeiro › Extrato) ---------- */

export async function importStatementAction(formData: FormData) {
  const file = formData.get("arquivo");
  formData.set("aba", "extrato");
  if (!(file instanceof File) || file.size === 0) {
    redirect(getPeriodTarget(formData, "/financeiro", { error: "Escolha o arquivo do extrato (PDF, OFX ou CSV)." }));
  }
  let result: Awaited<ReturnType<typeof importStatement>> | null = null;
  await runPeriodMutation(formData, "/financeiro", async () => {
    result = await importStatement({ bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name });
  });
  const r = result as unknown as Awaited<ReturnType<typeof importStatement>>;
  done(
    formData,
    "/financeiro",
    `Extrato lido e conferido (${r.parsed.lines.length} movimentações). ${r.created} novas para classificar${r.repeated ? `, ${r.repeated} já tinham sido importadas antes` : ""}.`,
  );
}

export async function applyStatementAction(formData: FormData) {
  formData.set("aba", "extrato");
  let actions: StatementAction[] = [];
  try {
    actions = JSON.parse(String(formData.get("payload") || "[]")) as StatementAction[];
  } catch {
    redirect(getPeriodTarget(formData, "/financeiro", { error: "Não foi possível ler a classificação. Tente de novo." }));
  }
  let counts = { lancar: 0, transferir: 0, vincular: 0, ignorar: 0 };
  await runPeriodMutation(formData, "/financeiro", async () => {
    counts = await applyStatementActions(actions);
  });
  const parts = [
    counts.lancar ? `${counts.lancar} lançada(s)` : "",
    counts.transferir ? `${counts.transferir} transferência(s)` : "",
    counts.vincular ? `${counts.vincular} vinculada(s) a lançamentos que já existiam` : "",
    counts.ignorar ? `${counts.ignorar} ignorada(s)` : "",
  ].filter(Boolean);
  done(formData, "/financeiro", `Extrato: ${parts.join(", ") || "nada mudou"}.`);
}

export async function reopenStatementLineAction(formData: FormData) {
  formData.set("aba", "extrato");
  await runPeriodMutation(formData, "/financeiro", () => reopenStatementLine(Number(formData.get("id"))));
  done(formData, "/financeiro", "Linha devolvida para a revisão.");
}

/* ---------- Importar compra pelo cupom (Compras › Registrar) ---------- */

export async function readInvoiceAction(
  formData: FormData,
): Promise<{ ok: true; draft: InvoiceDraft } | { ok: false; error: string }> {
  try {
    const file = formData.get("arquivo");
    const pdf = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : undefined;
    const draft = await readInvoice({ text: cleanText(formData.get("texto")), pdf });
    return { ok: true, draft };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível ler a nota." };
  }
}
