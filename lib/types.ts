export type SearchParams = Record<string, string | string[] | undefined>;
export type ReportScope = "month" | "year";

export type PeriodOption = {
  id: number;
  year: number;
  month: number;
  label: string;
  isClosed: boolean;
  closedAt: string | null;
};

export type PaymentMethodKind = "asset" | "liability";

export type PaymentMethod = {
  id: number;
  name: string;
  kind: PaymentMethodKind;
};

export type MovementTypeGroup = "income" | "expense" | "neutral";

export type MovementType = {
  id: number;
  name: string;
  group_name: MovementTypeGroup;
  affects_report: number;
};

export type ItemCategory = {
  id: number;
  name: string;
};

export type ItemRecord = {
  id: number;
  name: string;
  category_id: number | null;
  category_name: string | null;
  unit_size: number | null;
  reference_price: number | null;
  price_per_kg: number | null;
  low_stock_threshold: number;
  notes: string | null;
  is_active: number;
  content_qty: number | null;
  content_unit: "g" | "ml" | "un" | null;
};

export type ItemMetrics = {
  id: number;
  name: string;
  categoryName: string;
  isActive: boolean;
  unitSize: number | null;
  referencePrice: number | null;
  openingQty: number;
  openingValue: number;
  entriesQty: number;
  entriesValue: number;
  availableQty: number;
  availableValue: number;
  averageCost: number;
  usageQty: number;
  cmv: number;
  finalQty: number;
  finalValue: number;
  finalAverageCost: number;
  lowStockThreshold: number;
};

export type DashboardMetric = {
  label: string;
  value: number;
  note?: string;
};

export type InventoryEntryRow = {
  id: number;
  movement_date: string;
  payment_method_id: number;
  payment_method_name: string;
  item_id: number;
  item_name: string;
  quantity: number;
  total_amount: number;
  notes: string | null;
  source: string | null;
  purchase_id?: number | null;
  supplier_name?: string | null;
  invoice_number?: string | null;
};

export type InventoryUsageRow = {
  id: number;
  movement_date: string;
  item_id: number;
  item_name: string;
  quantity: number;
  notes: string | null;
  source: string | null;
};

export type FinancialTransactionRow = {
  id: number;
  movement_date: string;
  payment_method_id: number;
  payment_method_name: string;
  movement_type_id: number;
  movement_type_name: string;
  description: string;
  amount: number;
  notes: string | null;
  item_id: number | null;
  item_name: string | null;
  source: string | null;
  purchase_id?: number | null;
  supplier_name?: string | null;
  invoice_number?: string | null;
};

export type SupplierRecord = {
  id: number;
  name: string;
  contact: string | null;
  notes: string | null;
  is_active: number;
};

export type PurchaseDestination = "inventory" | "financial";

export type PurchaseLineRecord = {
  id: number;
  destination: PurchaseDestination;
  item_id: number | null;
  item_name: string | null;
  description: string;
  quantity: number;
  total_amount: number;
  movement_type_id: number | null;
  movement_type_name: string | null;
  inventory_entry_id: number | null;
  financial_transaction_id: number | null;
};

export type PurchaseRecord = {
  id: number;
  period_id: number;
  purchase_date: string;
  supplier_id: number;
  supplier_name: string;
  payment_method_id: number;
  payment_method_name: string;
  invoice_number: string | null;
  notes: string | null;
  total_amount: number;
  inventory_amount: number;
  financial_amount: number;
  line_count: number;
  lines?: PurchaseLineRecord[];
};

export type PurchaseOverview = {
  purchaseCount: number;
  totalAmount: number;
  inventoryAmount: number;
  financialAmount: number;
  activeSupplierCount: number;
};

export type PurchaseInsight = {
  itemId: number;
  itemName: string;
  purchaseDays: number;
  closePurchaseIntervals: number;
  usageMonths: number;
  averageMonthlyUsage: number;
  currentQuantity: number;
  minimumUnitPrice: number;
  maximumUnitPrice: number;
  confidence: "high" | "medium" | "low";
};

export type PurchaseAnalysis = {
  isCurrentPeriodPartial: boolean;
  latestCountDate: string | null;
  insights: PurchaseInsight[];
};

export type TransferRow = {
  id: number;
  movement_date: string;
  from_payment_method_id: number;
  from_payment_method_name: string;
  to_payment_method_id: number;
  to_payment_method_name: string;
  amount: number;
  description: string;
  notes: string | null;
  source: string | null;
};

export type DashboardSummary = {
  period: PeriodOption;
  scope: ReportScope;
  summarySource: "dynamic" | "snapshot";
  hasOperationalDetail: boolean;
  metrics: DashboardMetric[];
  balances: Array<{
    paymentMethod: string;
    kind: PaymentMethodKind;
    opening: number;
    movement: number;
    final: number;
  }>;
  lowStockItems: ItemMetrics[];
  periodRevenueMix: Array<{
    label: string;
    value: number;
  }>;
  timeline: Array<{
    month: number;
    label: string;
    revenue: number;
    result: number;
    netProfit: number;
  }>;
  annualTotals: {
    revenue: number;
    cmv: number;
    inputs: number;
    expenses: number;
    netProfit: number;
    withdrawals: number;
    result: number;
  };
};

export type EditBundle = {
  item?: ItemRecord | null;
  inventoryEntry?: InventoryEntryRow | null;
  inventoryUsage?: InventoryUsageRow | null;
  financialTransaction?: FinancialTransactionRow | null;
  transfer?: TransferRow | null;
};

export type PeriodSummary = {
  revenue: number;
  cmv: number;
  inputs: number;
  expenses: number;
  netProfit: number;
  withdrawals: number;
  result: number;
  stockValue: number;
  availableBalance: number;
  source: "dynamic" | "snapshot";
};

export type ReportSnapshot = {
  period: PeriodOption;
  scope: ReportScope;
  summarySource: "dynamic" | "snapshot";
  hasOperationalDetail: boolean;
  selectedSummary: PeriodSummary;
  annualSummary: {
    year: number;
    totals: PeriodSummary;
  };
  monthlyRows: Array<{
    period: PeriodOption;
    summary: PeriodSummary;
  }>;
  dre: Array<{
    label: string;
    value: number;
  }>;
  balances: Array<{
    paymentMethod: string;
    kind: PaymentMethodKind;
    opening: number;
    movement: number;
    final: number;
  }>;
  items: ItemMetrics[];
};
