import { urls } from "../routes/urls.js";
import { listAccounts } from "../services/accountService.js";
import { parseDate, today } from "../services/dateUtils.js";
import {
  getBalanceSheet,
  getGeneralLedger,
  getIncomeStatement,
  getTrialBalance,
  getCashFlow,
  resolvePeriod
} from "../services/reportService.js";
import { AGING_BUCKETS, getAging, getDocumentBook } from "../services/invoiceService.js";
import { getVatSummary } from "../services/taxService.js";
import { getAccountingSettings } from "../services/settingService.js";

// Company block printed at the top of every report.
const companyHeader = (settings) => ({
  name: settings.companyName,
  tin: settings.companyTin,
  address: settings.companyAddress,
  currency: settings.currency
});

export const generalLedger = async (req, res) => {
  const settings = await getAccountingSettings();
  const period = resolvePeriod(req.query, settings.fiscalYearStartMonth);
  const accountUuid = typeof req.query.account === "string" ? req.query.account : "";
  const accounts = await listAccounts({ includeInactive: true });
  res.render("reportGeneralLedger", {
    title: "General Ledger",
    activeMenu: "ledger",
    urls,
    company: companyHeader(settings),
    period,
    accounts: accounts.map(({ uuid, code, name }) => ({ uuid, code, name, selected: uuid === accountUuid })),
    ledger: await getGeneralLedger({ accountUuid, ...period })
  });
};

export const trialBalance = async (req, res) => {
  const settings = await getAccountingSettings();
  const asOf = parseDate(req.query.as_of) ?? today();
  // Pre-closing view: leave out closing entries so revenue and expense balances still show.
  const excludeClosing = req.query.exclude_closing === "1";
  res.render("reportTrialBalance", {
    title: "Trial Balance",
    activeMenu: "trialBalance",
    urls,
    company: companyHeader(settings),
    asOf,
    excludeClosing,
    report: await getTrialBalance({ asOf, excludeClosing })
  });
};

export const incomeStatement = async (req, res) => {
  const settings = await getAccountingSettings();
  const period = resolvePeriod(req.query, settings.fiscalYearStartMonth);
  res.render("reportIncomeStatement", {
    title: "Income Statement",
    activeMenu: "incomeStatement",
    urls,
    company: companyHeader(settings),
    period,
    report: await getIncomeStatement(period)
  });
};

export const balanceSheet = async (req, res) => {
  const settings = await getAccountingSettings();
  const asOf = parseDate(req.query.as_of) ?? today();
  res.render("reportBalanceSheet", {
    title: "Balance Sheet",
    activeMenu: "balanceSheet",
    urls,
    company: companyHeader(settings),
    asOf,
    report: await getBalanceSheet({ asOf, fiscalYearStartMonth: settings.fiscalYearStartMonth })
  });
};

export const cashFlow = async (req, res) => {
  const settings = await getAccountingSettings();
  const period = resolvePeriod(req.query, settings.fiscalYearStartMonth);
  res.render("reportCashFlow", {
    title: "Cash Flow Statement",
    activeMenu: "cashFlow",
    urls,
    company: companyHeader(settings),
    period,
    report: await getCashFlow(period)
  });
};

export const aging = (kind) => async (req, res) => {
  const settings = await getAccountingSettings();
  const asOf = parseDate(req.query.as_of) ?? today();
  const isReceivable = kind === "invoice";
  res.render("reportAging", {
    title: isReceivable ? "Accounts Receivable Aging" : "Accounts Payable Aging",
    activeMenu: isReceivable ? "arAging" : "apAging",
    urls,
    company: companyHeader(settings),
    asOf,
    formAction: isReceivable ? urls.reportArAging : urls.reportApAging,
    contactLabel: isReceivable ? "Customer" : "Supplier",
    buckets: AGING_BUCKETS,
    report: await getAging(kind, asOf)
  });
};

export const vatSummary = async (req, res) => {
  const settings = await getAccountingSettings();
  const period = resolveQuarter(req.query);
  res.render("reportVatSummary", {
    title: "VAT Summary",
    activeMenu: "vatSummary",
    urls,
    company: companyHeader(settings),
    period,
    report: await getVatSummary(period)
  });
};

export const documentBook = (kind) => async (req, res) => {
  const settings = await getAccountingSettings();
  const period = resolveQuarter(req.query);
  const isSales = kind === "invoice";
  res.render("reportBook", {
    title: isSales ? "Sales Book" : "Purchase Book",
    activeMenu: isSales ? "salesBook" : "purchaseBook",
    urls,
    company: companyHeader(settings),
    period,
    formAction: isSales ? urls.reportSalesBook : urls.reportPurchaseBook,
    contactLabel: isSales ? "Customer" : "Supplier",
    numberLabel: isSales ? "Invoice No." : "Bill No.",
    report: await getDocumentBook(kind, period)
  });
};

// VAT is filed per quarter, so tax reports default to the current calendar quarter.
function resolveQuarter(query) {
  const now = today();
  const month = Number(now.slice(5, 7));
  const startMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const pad = (n) => String(n).padStart(2, "0");
  const defaultFrom = `${now.slice(0, 4)}-${pad(startMonth)}-01`;
  const from = parseDate(query.from) ?? defaultFrom;
  const to = parseDate(query.to) ?? now;
  return from <= to ? { from, to } : { from: to, to: from };
}
