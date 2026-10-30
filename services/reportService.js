import { QueryTypes } from "sequelize";
import { sequelize, Account } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { UUID_PATTERN } from "./accountService.js";
import { accountTypeLabel } from "./accountTypes.js";
import { formatEntryNumber, getAccountingSettings } from "./settingService.js";
import { fiscalYearStart, parseDate, today } from "./dateUtils.js";

const EARLIEST_DATE = "1000-01-01";
const TYPE_ORDER = `CASE a.type WHEN 'asset' THEN 1 WHEN 'liability' THEN 2 WHEN 'equity' THEN 3 WHEN 'revenue' THEN 4 ELSE 5 END`;

// Every report sums in integer cents and converts to pesos only for display.
export const cents = (value) => Math.round(Number(value ?? 0) * 100);
const pesos = (value) => value / 100;

// Resolves ?from=&to= into a valid period, defaulting to the fiscal year to date.
export function resolvePeriod(query, fiscalYearStartMonth) {
  const to = parseDate(query.to) ?? today();
  const from = parseDate(query.from) ?? fiscalYearStart(to, fiscalYearStartMonth);
  return from <= to ? { from, to } : { from: to, to: from };
}

export function ledgerUrl(uuid, from, to) {
  const params = new URLSearchParams({ account: uuid });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return `${urls.reportGeneralLedger}?${params}`;
}

// Debit and credit totals per account for entries dated within [from, to]. Closing entries can be
// left out so revenue and expense show their activity instead of the zeroed post-closing balance.
export async function accountTotals({ from = EARLIEST_DATE, to, excludeClosing = false }) {
  const closingFilter = excludeClosing ? "AND e.entry_type <> 'closing'" : "";
  const rows = await sequelize.query(
    `SELECT a.accounting_account_id, a.uuid, a.code, a.name, a.type, a.normal_balance,
       COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
     FROM accounting_account a
     LEFT JOIN (accounting_journal_line l
       INNER JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = l.journal_entry_id)
       ON l.account_id = a.accounting_account_id AND e.entry_date BETWEEN ? AND ? ${closingFilter}
     GROUP BY a.accounting_account_id
     ORDER BY ${TYPE_ORDER}, a.code`,
    { replacements: [from, to], type: QueryTypes.SELECT }
  );
  return rows.map((r) => ({
    accountingAccountId: r.accounting_account_id,
    uuid: r.uuid,
    code: r.code,
    name: r.name,
    type: r.type,
    typeLabel: accountTypeLabel(r.type),
    normalBalance: r.normal_balance,
    debit: cents(r.debit),
    credit: cents(r.credit)
  }));
}

const hasActivity = (row) => row.debit !== 0 || row.credit !== 0;

// One statement section. `sign` 1 means debit-positive (assets, expenses), -1 credit-positive.
function section(rows, type, sign, period) {
  const accounts = rows
    .filter((r) => r.type === type && hasActivity(r))
    .map((r) => ({
      code: r.code,
      name: r.name,
      cents: sign * (r.debit - r.credit),
      ledgerUrl: ledgerUrl(r.uuid, period.from, period.to)
    }));
  const total = accounts.reduce((sum, a) => sum + a.cents, 0);
  return {
    accounts: accounts.map(({ cents: c, ...a }) => ({ ...a, amount: pesos(c) })),
    totalCents: total,
    total: pesos(total)
  };
}

export const netIncomeCents = (rows) =>
  rows.reduce((sum, r) => {
    if (r.type === "revenue") return sum + (r.credit - r.debit);
    if (r.type === "expense") return sum - (r.debit - r.credit);
    return sum;
  }, 0);

export async function getTrialBalance({ asOf, excludeClosing = false }) {
  const rows = await accountTotals({ to: asOf, excludeClosing });
  let totalDebit = 0;
  let totalCredit = 0;
  const accounts = rows
    .filter(hasActivity)
    .map((r) => {
      const net = r.debit - r.credit;
      if (net === 0) return null;
      if (net > 0) totalDebit += net;
      else totalCredit -= net;
      return {
        code: r.code,
        name: r.name,
        typeLabel: r.typeLabel,
        debit: net > 0 ? pesos(net) : 0,
        credit: net < 0 ? pesos(-net) : 0,
        ledgerUrl: ledgerUrl(r.uuid, null, asOf)
      };
    })
    .filter(Boolean);
  return {
    accounts,
    totalDebit: pesos(totalDebit),
    totalCredit: pesos(totalCredit),
    balanced: totalDebit === totalCredit,
    difference: pesos(Math.abs(totalDebit - totalCredit))
  };
}

export async function getIncomeStatement({ from, to }) {
  const rows = await accountTotals({ from, to, excludeClosing: true });
  const period = { from, to };
  const revenue = section(rows, "revenue", -1, period);
  const expense = section(rows, "expense", 1, period);
  const net = revenue.totalCents - expense.totalCents;
  return { revenue, expense, netIncome: pesos(net), isLoss: net < 0 };
}

export async function getBalanceSheet({ asOf, fiscalYearStartMonth }) {
  const allTime = await accountTotals({ to: asOf });
  const fyStart = fiscalYearStart(asOf, fiscalYearStartMonth);
  const currentYear = await accountTotals({ from: fyStart, to: asOf });
  const period = { from: null, to: asOf };

  const assets = section(allTime, "asset", 1, period);
  const liabilities = section(allTime, "liability", -1, period);
  const equity = section(allTime, "equity", -1, period);

  // There are no closing entries, so revenue and expenses are carried into equity here:
  // earnings before this fiscal year, and earnings of the current fiscal year to date.
  const currentEarnings = netIncomeCents(currentYear);
  const priorEarnings = netIncomeCents(allTime) - currentEarnings;
  const totalEquity = equity.totalCents + priorEarnings + currentEarnings;
  const totalLiabilitiesAndEquity = liabilities.totalCents + totalEquity;

  return {
    assets,
    liabilities,
    equity,
    fiscalYearStart: fyStart,
    priorEarnings: pesos(priorEarnings),
    hasPriorEarnings: priorEarnings !== 0,
    currentEarnings: pesos(currentEarnings),
    totalEquity: pesos(totalEquity),
    totalLiabilitiesAndEquity: pesos(totalLiabilitiesAndEquity),
    balanced: assets.totalCents === totalLiabilitiesAndEquity,
    difference: pesos(Math.abs(assets.totalCents - totalLiabilitiesAndEquity))
  };
}

export async function getGeneralLedger({ accountUuid, from, to }) {
  const account =
    accountUuid && UUID_PATTERN.test(accountUuid)
      ? await Account.findOne({ where: { uuid: accountUuid }, raw: true })
      : null;
  if (!account) return null;

  // Balances follow the account's normal side, so a credit account grows with credits.
  const sign = account.normal_balance === "debit" ? 1 : -1;
  const [opening] = await sequelize.query(
    `SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
     FROM accounting_journal_line l
     INNER JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = l.journal_entry_id
     WHERE l.account_id = ? AND e.entry_date < ?`,
    { replacements: [account.accounting_account_id, from], type: QueryTypes.SELECT }
  );
  const rows = await sequelize.query(
    `SELECT l.debit, l.credit, l.description, e.uuid, e.accounting_journal_entry_id, e.reference,
       e.description AS entry_description, DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entry_date
     FROM accounting_journal_line l
     INNER JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = l.journal_entry_id
     WHERE l.account_id = ? AND e.entry_date BETWEEN ? AND ?
     ORDER BY e.entry_date, e.accounting_journal_entry_id, l.sort_order, l.accounting_journal_line_id`,
    { replacements: [account.accounting_account_id, from, to], type: QueryTypes.SELECT }
  );

  const { entryPrefix } = await getAccountingSettings();
  const openingCents = sign * (cents(opening.debit) - cents(opening.credit));
  let running = openingCents;
  let totalDebit = 0;
  let totalCredit = 0;
  const lines = rows.map((r) => {
    const debit = cents(r.debit);
    const credit = cents(r.credit);
    totalDebit += debit;
    totalCredit += credit;
    running += sign * (debit - credit);
    return {
      entryDate: r.entry_date,
      entryNumber: formatEntryNumber(r.accounting_journal_entry_id, entryPrefix),
      viewUrl: urls.accountingJournalView(r.uuid),
      reference: r.reference,
      description: r.description || r.entry_description,
      debit: pesos(debit),
      credit: pesos(credit),
      balance: pesos(running)
    };
  });

  return {
    account: {
      uuid: account.uuid,
      code: account.code,
      name: account.name,
      typeLabel: accountTypeLabel(account.type),
      normalBalance: account.normal_balance
    },
    openingBalance: pesos(openingCents),
    lines,
    totalDebit: pesos(totalDebit),
    totalCredit: pesos(totalCredit),
    closingBalance: pesos(running)
  };
}

// Direct-method cash flow: every entry that touches a cash account is classified by its other
// (non-cash) lines. Because each entry balances, those lines' credits minus debits equal the cash
// that moved, so the three sections always add up to the change in cash.
export async function getCashFlow({ from, to }) {
  const rows = await sequelize.query(
    `SELECT a.uuid, a.code, a.name, a.cash_flow_category AS category,
       SUM(l.credit) - SUM(l.debit) AS amount
     FROM accounting_journal_line l
     INNER JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = l.journal_entry_id
     INNER JOIN accounting_account a ON a.accounting_account_id = l.account_id
     WHERE e.entry_date BETWEEN ? AND ? AND a.is_cash = 0
       AND EXISTS (
         SELECT 1 FROM accounting_journal_line cl
         INNER JOIN accounting_account ca ON ca.accounting_account_id = cl.account_id
         WHERE cl.journal_entry_id = e.accounting_journal_entry_id AND ca.is_cash = 1
       )
     GROUP BY a.accounting_account_id
     ORDER BY a.code`,
    { replacements: [from, to], type: QueryTypes.SELECT }
  );
  const cashBalance = async (operator, date) => {
    const [row] = await sequelize.query(
      `SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS balance
       FROM accounting_journal_line l
       INNER JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = l.journal_entry_id
       INNER JOIN accounting_account a ON a.accounting_account_id = l.account_id
       WHERE a.is_cash = 1 AND e.entry_date ${operator} ?`,
      { replacements: [date], type: QueryTypes.SELECT }
    );
    return cents(row.balance);
  };
  const sections = ["operating", "investing", "financing"].map((category) => {
    const accounts = rows
      .filter((r) => r.category === category && cents(r.amount) !== 0)
      .map((r) => ({ code: r.code, name: r.name, cents: cents(r.amount), ledgerUrl: ledgerUrl(r.uuid, from, to) }));
    const total = accounts.reduce((sum, a) => sum + a.cents, 0);
    return {
      key: category,
      label: { operating: "Operating activities", investing: "Investing activities", financing: "Financing activities" }[category],
      accounts: accounts.map(({ cents: c, ...a }) => ({ ...a, amount: pesos(c) })),
      totalCents: total,
      total: pesos(total)
    };
  });
  const netChange = sections.reduce((sum, s) => sum + s.totalCents, 0);
  const opening = await cashBalance("<", from);
  const closing = await cashBalance("<=", to);
  return {
    sections,
    netChange: pesos(netChange),
    openingCash: pesos(opening),
    closingCash: pesos(closing),
    balanced: opening + netChange === closing,
    difference: pesos(Math.abs(opening + netChange - closing))
  };
}

// Revenue and expenses per month of a period, for the dashboard.
export async function getMonthlyResults({ from, to }) {
  const rows = await sequelize.query(
    `SELECT DATE_FORMAT(e.entry_date, '%Y-%m') AS month,
       COALESCE(SUM(CASE WHEN a.type = 'revenue' THEN l.credit - l.debit ELSE 0 END), 0) AS revenue,
       COALESCE(SUM(CASE WHEN a.type = 'expense' THEN l.debit - l.credit ELSE 0 END), 0) AS expense
     FROM accounting_journal_line l
     INNER JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = l.journal_entry_id
     INNER JOIN accounting_account a ON a.accounting_account_id = l.account_id
     WHERE e.entry_date BETWEEN ? AND ? AND e.entry_type <> 'closing'
     GROUP BY month
     ORDER BY month`,
    { replacements: [from, to], type: QueryTypes.SELECT }
  );
  return rows.map((r) => {
    const revenue = cents(r.revenue);
    const expense = cents(r.expense);
    return { month: r.month, revenue: pesos(revenue), expense: pesos(expense), net: pesos(revenue - expense) };
  });
}

export async function getCashBalances(asOf) {
  const rows = await sequelize.query(
    `SELECT a.uuid, a.code, a.name, COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS balance
     FROM accounting_account a
     LEFT JOIN (accounting_journal_line l
       INNER JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = l.journal_entry_id)
       ON l.account_id = a.accounting_account_id AND e.entry_date <= ?
     WHERE a.is_cash = 1
     GROUP BY a.accounting_account_id
     ORDER BY a.code`,
    { replacements: [asOf], type: QueryTypes.SELECT }
  );
  const accounts = rows.map((r) => ({ code: r.code, name: r.name, balance: pesos(cents(r.balance)), ledgerUrl: ledgerUrl(r.uuid, null, asOf) }));
  return { accounts, total: pesos(rows.reduce((sum, r) => sum + cents(r.balance), 0)) };
}
