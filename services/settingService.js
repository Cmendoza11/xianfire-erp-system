import { sequelize, Account, Setting } from "../models/index.js";
import { AccountingValidationError } from "./accountTypes.js";

export const DEFAULT_ENTRY_PREFIX = "JE-";
const DEFAULT_CURRENCY = "PHP";

let cache;

export async function refreshSetting() {
  cache = await Setting.findAll({ raw: true });
}

export async function getSetting(name, defaultValue) {
  if (!cache) {
    await refreshSetting();
  }
  const row = cache.find((s) => s.name === name);
  if (!row) {
    return defaultValue;
  }
  if (row.is_json) {
    try {
      return JSON.parse(row.value);
    } catch {
      return defaultValue;
    }
  }
  return row.value;
}

// Upserts every key in the payload: objects/arrays are stored as JSON, null/undefined as an empty string.
export async function saveSettings(values) {
  await sequelize.transaction(async (transaction) => {
    for (const [name, value] of Object.entries(values)) {
      const isJson = value !== null && typeof value === "object";
      await Setting.upsert(
        { name, value: isJson ? JSON.stringify(value) : String(value ?? ""), is_json: isJson },
        { transaction }
      );
    }
  });
  await refreshSetting();
}

function toMonth(value) {
  const n = parseInt(String(value ?? ""), 10);
  return n >= 1 && n <= 12 ? n : 1;
}

export async function getAccountingSettings() {
  const prefix = String(await getSetting("accountingEntryPrefix", DEFAULT_ENTRY_PREFIX)).trim();
  return {
    companyName: String(await getSetting("accountingCompanyName", "")),
    companyTin: String(await getSetting("accountingCompanyTin", "")),
    companyAddress: String(await getSetting("accountingCompanyAddress", "")),
    currency:
      String(await getSetting("accountingCurrency", DEFAULT_CURRENCY)).trim().toUpperCase() ||
      DEFAULT_CURRENCY,
    fiscalYearStartMonth: toMonth(await getSetting("accountingFiscalYearStart", 1)),
    entryPrefix: prefix || DEFAULT_ENTRY_PREFIX
  };
}

export function formatEntryNumber(id, prefix = DEFAULT_ENTRY_PREFIX) {
  return `${prefix}${String(id).padStart(6, "0")}`;
}

// Control accounts used when invoices, bills and payments post to the ledger. Each setting holds
// an account uuid; when it is unset the default chart's account with that code is used.
export const CONTROL_ACCOUNTS = [
  { key: "accountingArAccount", role: "ar", label: "Accounts Receivable", defaultCode: "1100", type: "asset" },
  { key: "accountingApAccount", role: "ap", label: "Accounts Payable", defaultCode: "2000", type: "liability" },
  { key: "accountingOutputVatAccount", role: "outputVat", label: "Output VAT", defaultCode: "2200", type: "liability" },
  { key: "accountingInputVatAccount", role: "inputVat", label: "Input VAT", defaultCode: "1400", type: "asset" }
];

const DEFAULT_VAT_RATE = 12;
const DEFAULT_PAYMENT_TERMS_DAYS = 30;

export async function getSalesPurchaseSettings() {
  const vatRate = Number(await getSetting("accountingVatRate", DEFAULT_VAT_RATE));
  const terms = parseInt(String(await getSetting("accountingPaymentTermsDays", DEFAULT_PAYMENT_TERMS_DAYS)), 10);
  return {
    vatRate: Number.isFinite(vatRate) && vatRate >= 0 && vatRate <= 100 ? vatRate : DEFAULT_VAT_RATE,
    paymentTermsDays: Number.isFinite(terms) && terms >= 0 ? terms : DEFAULT_PAYMENT_TERMS_DAYS,
    invoicePrefix: String(await getSetting("accountingInvoicePrefix", "INV-")).trim() || "INV-",
    billPrefix: String(await getSetting("accountingBillPrefix", "BILL-")).trim() || "BILL-"
  };
}

// Resolves every control account; throws when one is missing so nothing posts to a wrong account.
export async function getControlAccounts() {
  const result = {};
  for (const control of CONTROL_ACCOUNTS) {
    const uuid = String(await getSetting(control.key, "")).trim();
    const account =
      (uuid && (await Account.findOne({ where: { uuid }, raw: true }))) ||
      (await Account.findOne({ where: { code: control.defaultCode, type: control.type }, raw: true }));
    if (!account) {
      throw new AccountingValidationError(
        `Set the ${control.label} account in Accounting Settings before posting invoices or bills`
      );
    }
    result[control.role] = account;
  }
  return result;
}
