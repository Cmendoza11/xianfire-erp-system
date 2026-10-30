import { Account } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { currencies } from "../services/currencies.js";
import { diffFields, logAudit } from "../services/auditService.js";
import { hasClosedPeriods } from "../services/periodService.js";
import {
  CONTROL_ACCOUNTS,
  getAccountingSettings,
  getControlAccounts,
  getSalesPurchaseSettings,
  getSetting,
  saveSettings
} from "../services/settingService.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const MAX_PREFIX_LENGTH = 10;
const PREFIX_KEYS = ["accountingEntryPrefix", "accountingInvoicePrefix", "accountingBillPrefix"];

// Only these keys can be saved; anything else in the payload is rejected.
const ALLOWED_KEYS = [
  "accountingCompanyName", "accountingCompanyTin", "accountingCompanyAddress", "accountingCurrency",
  "accountingFiscalYearStart", "accountingVatRate", "accountingPaymentTermsDays",
  ...PREFIX_KEYS,
  ...CONTROL_ACCOUNTS.map((c) => c.key)
];

const badRequest = (res, message) => res.status(400).json({ error: { status: 400, message } });

export const accountingSettingPage = async (req, res) => {
  const settings = await getAccountingSettings();
  const salesPurchase = await getSalesPurchaseSettings();
  let controls = {};
  try {
    controls = await getControlAccounts();
  } catch {
    // A missing control account is shown as unselected so the admin can pick one here.
    controls = {};
  }
  const accounts = await Account.findAll({ where: { status: 1 }, order: [["code", "ASC"]], raw: true });
  res.render("accountingSetting", {
    title: "Accounting Setting",
    activeMenu: "setting",
    urls,
    // Not "settings": Express reserves that render key for its own app settings.
    accountingSettings: settings,
    salesPurchase,
    controlAccounts: CONTROL_ACCOUNTS.map((control) => ({
      key: control.key,
      label: control.label,
      options: accounts
        .filter((a) => a.type === control.type)
        .map((a) => ({
          uuid: a.uuid,
          label: `${a.code} - ${a.name}`,
          selected: controls[control.role]?.accounting_account_id === a.accounting_account_id
        }))
    })),
    currencies: currencies.map((c) => ({ ...c, selected: c.code === settings.currency })),
    months: MONTHS.map((label, i) => ({
      value: i + 1,
      label,
      selected: i + 1 === settings.fiscalYearStartMonth
    })),
    maxPrefixLength: MAX_PREFIX_LENGTH
  });
};

export const saveSetting = async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest(res, "Invalid settings payload");
  }
  const unknown = Object.keys(body).filter((key) => !ALLOWED_KEYS.includes(key));
  if (unknown.length > 0) {
    return badRequest(res, `Unknown setting: ${unknown.join(", ")}`);
  }
  for (const key of PREFIX_KEYS) {
    if (typeof body[key] === "string" && body[key].length > MAX_PREFIX_LENGTH) {
      return badRequest(res, `Use ${MAX_PREFIX_LENGTH} characters or fewer`);
    }
  }
  if ("accountingVatRate" in body) {
    const rate = Number(body.accountingVatRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return badRequest(res, "VAT rate must be between 0 and 100");
  }
  if ("accountingPaymentTermsDays" in body) {
    const days = Number(body.accountingPaymentTermsDays);
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      return badRequest(res, "Payment terms must be a whole number of days from 0 to 365");
    }
  }
  for (const control of CONTROL_ACCOUNTS) {
    if (!(control.key in body)) continue;
    const account = await Account.findOne({ where: { uuid: String(body[control.key]), type: control.type }, raw: true });
    if (!account) return badRequest(res, `Select a ${control.type} account for ${control.label}`);
  }
  // Closed years are stored by their start/end dates; moving the fiscal year start would no
  // longer line up with them.
  const current = await getAccountingSettings();
  if (
    "accountingFiscalYearStart" in body &&
    Number(body.accountingFiscalYearStart) !== current.fiscalYearStartMonth &&
    (await hasClosedPeriods())
  ) {
    return badRequest(res, "Reopen all closed fiscal years before changing the fiscal year start month");
  }
  const before = {};
  for (const key of Object.keys(body)) {
    before[key] = await getSetting(key, "");
  }
  await saveSettings(body);
  const changes = diffFields(before, body, Object.keys(body));
  if (Object.keys(changes).length > 0) {
    await logAudit(req, {
      action: "settings.update",
      entityType: "setting",
      summary: `Updated settings: ${Object.keys(changes).join(", ")}`,
      details: changes
    });
  }
  res.json({ data: {}, warnings: [] });
};
