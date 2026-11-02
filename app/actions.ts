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
  const id = Number(formData.get("id")) || undefined;

  await runPeriodMutation(formData, "/compras", () =>
    createOrUpdatePurchase({
      id,
      date: cleanText(formData.get("date")),
      supplierId: Number(formData.get("supplierId")),
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

  // Depois de salvar, mostra o histórico do mês da compra.
  formData.set("aba", "historico");
  done(formData, "/compras", id ? "Compra atualizada. Estoque e financeiro acompanharam." : "Compra registrada. Estoque e financeiro já foram atualizados.");
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
  done(formData, "/financeiro", id ? "Lançamento atualizado." : "Lançamento registrado.");
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
