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
import { cleanText, clampNumber, buildPeriodHref } from "@/lib/utils";

function getPeriodTarget(formData: FormData, pathname: string, extras?: Record<string, string | number>) {
  const year = Number(formData.get("year")) || 2026;
  const month = Number(formData.get("month")) || 4;
  return buildPeriodHref(pathname, year, month, extras);
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
    const message = error instanceof Error ? error.message : "Não foi possível concluir a operação.";
    redirect(getPeriodTarget(formData, pathname, { error: message }));
  }
}

export async function saveItemAction(formData: FormData) {
  await createOrUpdateItem({
    id: Number(formData.get("id")) || undefined,
    name: cleanText(formData.get("name")),
    categoryName: cleanText(formData.get("categoryName")) || "Outros",
    unitSize: formData.get("unitSize") ? clampNumber(formData.get("unitSize"), 0) : null,
    referencePrice: formData.get("referencePrice")
      ? clampNumber(formData.get("referencePrice"), 0)
      : null,
    pricePerKg: formData.get("pricePerKg") ? clampNumber(formData.get("pricePerKg"), 0) : null,
    lowStockThreshold: clampNumber(formData.get("lowStockThreshold"), 0),
    notes: cleanText(formData.get("notes")),
  });

  revalidatePath("/");
  revalidatePath("/estoque");
  revalidatePath("/movimentacoes");
  revalidatePath("/relatorios");
  redirect(getPeriodTarget(formData, "/estoque"));
}

export async function deleteItemAction(formData: FormData) {
  await deactivateItem(Number(formData.get("id")));
  revalidatePath("/");
  revalidatePath("/estoque");
  revalidatePath("/movimentacoes");
  revalidatePath("/relatorios");
  redirect(getPeriodTarget(formData, "/estoque"));
}

export async function reactivateItemAction(formData: FormData) {
  await reactivateItem(Number(formData.get("id")));
  revalidatePath("/");
  revalidatePath("/estoque");
  revalidatePath("/movimentacoes");
  revalidatePath("/relatorios");
  redirect(getPeriodTarget(formData, "/estoque", { showArchived: 1 }));
}

export async function saveInventoryEntryAction(formData: FormData) {
  await runPeriodMutation(formData, "/movimentacoes", () => createOrUpdateInventoryEntry({
    id: Number(formData.get("id")) || undefined,
    date: cleanText(formData.get("date")),
    paymentMethodId: Number(formData.get("paymentMethodId")),
    itemId: Number(formData.get("itemId")),
    quantity: clampNumber(formData.get("quantity"), 0),
    totalAmount: clampNumber(formData.get("totalAmount"), 0),
    notes: cleanText(formData.get("notes")),
  }));

  revalidatePath("/");
  revalidatePath("/estoque");
  revalidatePath("/movimentacoes");
  revalidatePath("/financeiro");
  revalidatePath("/relatorios");
  redirect(getPeriodTarget(formData, "/movimentacoes"));
}

function revalidatePurchasePages() {
  revalidatePath("/");
  revalidatePath("/compras");
  revalidatePath("/estoque");
  revalidatePath("/movimentacoes");
  revalidatePath("/financeiro");
  revalidatePath("/relatorios");
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
  revalidatePurchasePages();
  redirect(getPeriodTarget(formData, "/compras", { notice: "Fornecedor salvo." }));
}

export async function archiveSupplierAction(formData: FormData) {
  await runPeriodMutation(formData, "/compras", () =>
    setSupplierActive(Number(formData.get("id")), false),
  );
  revalidatePurchasePages();
  redirect(getPeriodTarget(formData, "/compras", { notice: "Fornecedor arquivado." }));
}

export async function reactivateSupplierAction(formData: FormData) {
  await runPeriodMutation(formData, "/compras", () =>
    setSupplierActive(Number(formData.get("id")), true),
  );
  revalidatePurchasePages();
  redirect(getPeriodTarget(formData, "/compras", { notice: "Fornecedor reativado." }));
}

export async function savePurchaseAction(formData: FormData) {
  const destinations = formData.getAll("lineDestination");
  const itemIds = formData.getAll("lineItemId");
  const descriptions = formData.getAll("lineDescription");
  const quantities = formData.getAll("lineQuantity");
  const amounts = formData.getAll("lineAmount");
  const movementTypeIds = formData.getAll("lineMovementTypeId");

  await runPeriodMutation(formData, "/compras", () =>
    createOrUpdatePurchase({
      id: Number(formData.get("id")) || undefined,
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
      })),
    }),
  );

  revalidatePurchasePages();
  redirect(getPeriodTarget(formData, "/compras", { notice: "Compra salva e lançamentos atualizados." }));
}

export async function deletePurchaseAction(formData: FormData) {
  await runPeriodMutation(formData, "/compras", () =>
    deletePurchase(Number(formData.get("id"))),
  );
  revalidatePurchasePages();
  redirect(getPeriodTarget(formData, "/compras", { notice: "Compra excluída e lançamentos removidos." }));
}

export async function deleteInventoryEntryAction(formData: FormData) {
  await runPeriodMutation(formData, "/movimentacoes", () =>
    deleteInventoryEntry(Number(formData.get("id"))),
  );
  revalidatePath("/");
  revalidatePath("/estoque");
  revalidatePath("/movimentacoes");
  revalidatePath("/financeiro");
  revalidatePath("/relatorios");
  redirect(getPeriodTarget(formData, "/movimentacoes"));
}

export async function saveInventoryUsageAction(formData: FormData) {
  await runPeriodMutation(formData, "/movimentacoes", () => createOrUpdateInventoryUsage({
    id: Number(formData.get("id")) || undefined,
    date: cleanText(formData.get("date")),
    itemId: Number(formData.get("itemId")),
    quantity: clampNumber(formData.get("quantity"), 0),
    notes: cleanText(formData.get("notes")),
  }));

  revalidatePath("/");
  revalidatePath("/estoque");
  revalidatePath("/movimentacoes");
  revalidatePath("/relatorios");
  redirect(getPeriodTarget(formData, "/movimentacoes"));
}

export async function deleteInventoryUsageAction(formData: FormData) {
  await runPeriodMutation(formData, "/movimentacoes", () =>
    deleteInventoryUsage(Number(formData.get("id"))),
  );
  revalidatePath("/");
  revalidatePath("/estoque");
  revalidatePath("/movimentacoes");
  revalidatePath("/relatorios");
  redirect(getPeriodTarget(formData, "/movimentacoes"));
}

export async function saveFinancialTransactionAction(formData: FormData) {
  await runPeriodMutation(formData, "/financeiro", () => createOrUpdateFinancialTransaction({
    id: Number(formData.get("id")) || undefined,
    date: cleanText(formData.get("date")),
    paymentMethodId: Number(formData.get("paymentMethodId")),
    movementTypeId: Number(formData.get("movementTypeId")),
    description: cleanText(formData.get("description")),
    amount: clampNumber(formData.get("amount"), 0),
    itemId: Number(formData.get("itemId")) || null,
    notes: cleanText(formData.get("notes")),
  }));

  revalidatePath("/");
  revalidatePath("/financeiro");
  revalidatePath("/relatorios");
  redirect(getPeriodTarget(formData, "/financeiro"));
}

export async function deleteFinancialTransactionAction(formData: FormData) {
  await runPeriodMutation(formData, "/financeiro", () =>
    deleteFinancialTransaction(Number(formData.get("id"))),
  );
  revalidatePath("/");
  revalidatePath("/financeiro");
  revalidatePath("/relatorios");
  redirect(getPeriodTarget(formData, "/financeiro"));
}

export async function saveTransferAction(formData: FormData) {
  await runPeriodMutation(formData, "/financeiro", () => createOrUpdateTransfer({
    id: Number(formData.get("id")) || undefined,
    date: cleanText(formData.get("date")),
    fromPaymentMethodId: Number(formData.get("fromPaymentMethodId")),
    toPaymentMethodId: Number(formData.get("toPaymentMethodId")),
    amount: clampNumber(formData.get("amount"), 0),
    description: cleanText(formData.get("description")),
    notes: cleanText(formData.get("notes")),
  }));

  revalidatePath("/");
  revalidatePath("/financeiro");
  revalidatePath("/relatorios");
  redirect(getPeriodTarget(formData, "/financeiro"));
}

export async function deleteTransferAction(formData: FormData) {
  await runPeriodMutation(formData, "/financeiro", () =>
    deleteTransfer(Number(formData.get("id"))),
  );
  revalidatePath("/");
  revalidatePath("/financeiro");
  revalidatePath("/relatorios");
  redirect(getPeriodTarget(formData, "/financeiro"));
}

function revalidateOperationalPages() {
  revalidatePath("/");
  revalidatePath("/estoque");
  revalidatePath("/movimentacoes");
  revalidatePath("/financeiro");
  revalidatePath("/relatorios");
}

export async function closePeriodAction(formData: FormData) {
  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  await runPeriodMutation(formData, "/financeiro", () =>
    setPeriodClosed({ year, month, closed: true }),
  );

  revalidateOperationalPages();
  redirect(getPeriodTarget(formData, "/financeiro", { notice: "Período fechado e protegido." }));
}

export async function reopenPeriodAction(formData: FormData) {
  if (formData.get("confirmReopen") !== "yes") {
    redirect(
      getPeriodTarget(formData, "/financeiro", {
        error: "Marque a confirmação antes de reabrir o período.",
      }),
    );
  }

  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  await runPeriodMutation(formData, "/financeiro", () =>
    setPeriodClosed({ year, month, closed: false }),
  );

  revalidateOperationalPages();
  redirect(getPeriodTarget(formData, "/financeiro", { notice: "Período reaberto para ajustes." }));
}
