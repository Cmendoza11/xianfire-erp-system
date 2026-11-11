import { QueryTypes } from "sequelize";
import { sequelize } from "../models/index.js";

// Read-only figures from the other DJ's ERP modules, which share this database through prefixed
// tables (hr_, pos_, scm_, crm_). Each module owns its tables; Accounting only reads them here.
// A module whose tables are not installed yet is reported as not connected instead of failing.

const select = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const num = (value) => Number(value ?? 0);

async function moduleSchema() {
  const rows = await select(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND (TABLE_NAME LIKE 'hr\\_%' OR TABLE_NAME LIKE 'pos\\_%' OR TABLE_NAME LIKE 'scm\\_%' OR TABLE_NAME LIKE 'crm\\_%')`
  );
  const tables = new Map();
  for (const { t, c } of rows) {
    if (!tables.has(t)) tables.set(t, new Set());
    tables.get(t).add(c);
  }
  return (table, ...columns) => tables.has(table) && columns.every((c) => tables.get(table).has(c));
}

// Day and month bounds in server-local time (the same clock the ERP uses for `today()`), as Dates
// so Sequelize converts them to the UTC the modules store.
function bounds(now = new Date()) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { dayStart, dayEnd, monthStart, monthEnd };
}

// Table and column names below are fixed strings from this file, never user input.
async function syncCounts(table, column, where = "1 = 1") {
  const rows = await select(`SELECT \`${column}\` AS status, COUNT(*) AS n FROM \`${table}\` WHERE ${where} GROUP BY \`${column}\``);
  const counts = { pending: 0, failed: 0, synced: 0 };
  for (const row of rows) {
    const key = String(row.status ?? "").toLowerCase();
    if (key in counts) counts[key] += num(row.n);
  }
  return counts;
}

async function posFigures(has, b) {
  if (!has("pos_transactions", "status", "totalAmount", "createdAt")) return null;
  const sales = `SELECT COUNT(*) AS n, COALESCE(SUM(totalAmount), 0) AS total FROM pos_transactions
                 WHERE status = 'Completed' AND createdAt >= :from AND createdAt < :to`;
  const [today] = await select(sales, { from: b.dayStart, to: b.dayEnd });
  const [month] = await select(sales, { from: b.monthStart, to: b.monthEnd });
  let lowStock = { count: 0, items: [] };
  if (has("pos_inventory", "currentStock", "minStockLevel") && has("pos_products", "name", "status")) {
    const where = `FROM pos_inventory i JOIN pos_products p ON p.id = i.productId
                   WHERE p.status = 'active' AND i.currentStock <= i.minStockLevel`;
    const [count] = await select(`SELECT COUNT(*) AS n ${where}`);
    const items = await select(`SELECT p.name, i.currentStock, i.minStockLevel, i.unit ${where} ORDER BY i.currentStock ASC, p.name LIMIT 5`);
    lowStock = { count: num(count.n), items };
  }
  return {
    todaySales: num(today.total),
    todayCount: num(today.n),
    monthSales: num(month.total),
    monthCount: num(month.n),
    lowStock,
    // The POS queues its messages in an outbox table (one row per sale / void and target module).
    accountingSync: has("pos_integration_outbox", "target", "status") ? await syncCounts("pos_integration_outbox", "status", "target = 'accounting'") : null,
    customerSync: has("pos_integration_outbox", "target", "status") ? await syncCounts("pos_integration_outbox", "status", "target = 'customers'") : null
  };
}

async function hrFigures(has, b) {
  if (!has("hr_employees", "status")) return null;
  const [employees] = await select(`SELECT COUNT(*) AS n FROM hr_employees WHERE status = 'Active'`);
  const [onLeave] = await select(`SELECT COUNT(*) AS n FROM hr_employees WHERE status = 'On Leave'`);
  let payroll = { total: 0, count: 0 };
  if (has("hr_payrolls", "netSalary", "status", "paidAt")) {
    const [row] = await select(
      `SELECT COUNT(*) AS n, COALESCE(SUM(netSalary), 0) AS total FROM hr_payrolls
       WHERE status = 'Paid' AND paidAt >= :from AND paidAt < :to`,
      { from: b.monthStart, to: b.monthEnd }
    );
    payroll = { total: num(row.total), count: num(row.n) };
  }
  return {
    activeEmployees: num(employees.n),
    onLeave: num(onLeave.n),
    payroll,
    accountingSync: has("hr_payrolls", "accountingSyncStatus") ? await syncCounts("hr_payrolls", "accountingSyncStatus") : null
  };
}

async function scmFigures(has) {
  if (!has("scm_purchase_orders", "status", "deletedAt", "totalAmount")) return null;
  const [openOrders] = await select(
    `SELECT COUNT(*) AS n, COALESCE(SUM(totalAmount), 0) AS total FROM scm_purchase_orders
     WHERE deletedAt IS NULL AND status IN ('Pending Approval', 'Approved', 'Sent to Supplier', 'Partially Received')`
  );
  let pendingRequests = 0;
  if (has("scm_purchase_requests", "status", "deletedAt")) {
    const [row] = await select(`SELECT COUNT(*) AS n FROM scm_purchase_requests WHERE deletedAt IS NULL AND status = 'Pending'`);
    pendingRequests = num(row.n);
  }
  let unpaid = { count: 0, total: 0 };
  if (has("scm_supplier_invoices", "paymentStatus", "outstandingBalance")) {
    const [row] = await select(
      `SELECT COUNT(*) AS n, COALESCE(SUM(outstandingBalance), 0) AS total FROM scm_supplier_invoices WHERE paymentStatus <> 'Paid'`
    );
    unpaid = { count: num(row.n), total: num(row.total) };
  }
  return {
    openOrders: num(openOrders.n),
    openOrdersTotal: num(openOrders.total),
    pendingRequests,
    unpaid,
    accountingSync: has("scm_supplier_invoices", "financialSyncStatus") ? await syncCounts("scm_supplier_invoices", "financialSyncStatus") : null,
    refundSync: has("scm_supplier_returns", "accountingSyncStatus") ? await syncCounts("scm_supplier_returns", "accountingSyncStatus") : null,
    stockSync: has("scm_goods_receipts", "inventorySyncStatus") ? await syncCounts("scm_goods_receipts", "inventorySyncStatus") : null,
    returnStockSync: has("scm_supplier_returns", "inventoryAdjustmentStatus") ? await syncCounts("scm_supplier_returns", "inventoryAdjustmentStatus") : null
  };
}

async function crmFigures(has, b) {
  if (!has("crm_customers", "customerId")) return null;
  const [customers] = await select(`SELECT COUNT(*) AS n FROM crm_customers`);
  let month = { count: 0, total: 0, fromPos: 0 };
  if (has("crm_customer_logs", "activityType", "amount", "activityAt", "sourceModule")) {
    // Net of refunds (a voided POS sale logs a refund against its purchase).
    const [row] = await select(
      `SELECT COALESCE(SUM(activityType = 'purchase'), 0) - COALESCE(SUM(activityType = 'refund'), 0) AS n,
              COALESCE(SUM(CASE activityType WHEN 'purchase' THEN amount WHEN 'refund' THEN -amount ELSE 0 END), 0) AS total,
              COALESCE(SUM(activityType = 'purchase' AND sourceModule = 'POS'), 0) - COALESCE(SUM(activityType = 'refund' AND sourceModule = 'POS'), 0) AS fromPos
       FROM crm_customer_logs WHERE activityType IN ('purchase', 'refund') AND activityAt >= :from AND activityAt < :to`,
      { from: b.monthStart, to: b.monthEnd }
    );
    month = { count: Math.max(num(row.n), 0), total: Math.max(num(row.total), 0), fromPos: Math.max(num(row.fromPos), 0) };
  }
  return { customers: num(customers.n), month };
}

// What each connected module has posted into Accounting through /api/v1.
async function postingsBySystem() {
  return select(
    `SELECT c.system_code AS systemCode, c.name, r.entity_type AS entityType, COUNT(*) AS n, MAX(r.created_at) AS lastAt
     FROM integration_reference r JOIN api_client c ON c.api_client_id = r.api_client_id
     WHERE r.entity_uuid IS NOT NULL
     GROUP BY c.system_code, c.name, r.entity_type
     ORDER BY c.name, r.entity_type`
  );
}

export async function getEnterpriseOverview(now = new Date()) {
  const has = await moduleSchema();
  const b = bounds(now);
  const [pos, hr, scm, crm, postings] = await Promise.all([
    posFigures(has, b), hrFigures(has, b), scmFigures(has), crmFigures(has, b), postingsBySystem()
  ]);
  const syncs = [
    pos?.accountingSync && { module: "POS → Accounting", ...pos.accountingSync },
    pos?.customerSync && { module: "POS → Customer Logs", ...pos.customerSync },
    hr?.accountingSync && { module: "HR payroll → Accounting", ...hr.accountingSync },
    scm?.accountingSync && { module: "Procurement bills → Accounting", ...scm.accountingSync },
    scm?.refundSync && { module: "Procurement refunds → Accounting", ...scm.refundSync },
    scm?.stockSync && { module: "Procurement receipts → POS stock", ...scm.stockSync },
    scm?.returnStockSync && { module: "Procurement returns → POS stock", ...scm.returnStockSync }
  ].filter(Boolean);
  return {
    pos, hr, scm, crm, postings, syncs,
    attention: syncs.reduce((sum, s) => sum + s.pending + s.failed, 0)
  };
}
