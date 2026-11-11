import { urls } from "../routes/urls.js";
import { fiscalYearLabel, fiscalYearStart, today } from "../services/dateUtils.js";
import { getOpenSummary, listOverdue } from "../services/invoiceService.js";
import { listJournalEntries } from "../services/journalService.js";
import { getLockDate } from "../services/periodService.js";
import { getCashBalances, getIncomeStatement, getMonthlyResults } from "../services/reportService.js";
import { getAccountingSettings } from "../services/settingService.js";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Cash accounts past this many share one neutral colour on the split bar.
const CASH_COLOR_SLOTS = 3;

// Months without postings are missing from the results, but a time axis needs them as zeros.
function fillMonths(results, from, to) {
  const byMonth = new Map(results.map((m) => [m.month, m]));
  const last = to.slice(0, 7);
  const months = [];
  let [year, month] = from.split("-").map(Number);
  for (let key = from.slice(0, 7); key <= last; key = `${year}-${String(month).padStart(2, "0")}`) {
    const found = byMonth.get(key);
    months.push({
      short: MONTH_NAMES[month - 1],
      label: `${MONTH_NAMES[month - 1]} ${year}`,
      revenue: found?.revenue ?? 0,
      expense: found?.expense ?? 0
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

export const dashboardPage = async (req, res) => {
  const settings = await getAccountingSettings();
  const to = today();
  const from = fiscalYearStart(to, settings.fiscalYearStartMonth);
  const income = await getIncomeStatement({ from, to });
  const monthly = await getMonthlyResults({ from, to });
  const cash = await getCashBalances(to);
  // An overdrawn account has no share of the cash on hand, so it only appears in the list.
  const positiveCash = cash.accounts.reduce((sum, a) => sum + Math.max(0, a.balance), 0);
  res.render("dashboard", {
    title: "Dashboard",
    activeMenu: "dashboard",
    urls,
    company: settings.companyName,
    currency: settings.currency,
    fiscalYear: fiscalYearLabel(from),
    period: { from, to },
    lockDate: await getLockDate(),
    cash: {
      ...cash,
      accounts: cash.accounts.map((account, index) => ({
        ...account,
        share: positiveCash > 0 ? (Math.max(0, account.balance) / positiveCash) * 100 : 0,
        slot: index < CASH_COLOR_SLOTS ? index + 1 : "other"
      }))
    },
    revenue: income.revenue.total,
    expenses: income.expense.total,
    netIncome: income.netIncome,
    isLoss: income.isLoss,
    netMargin: income.revenue.total > 0 ? `${Math.round((income.netIncome / income.revenue.total) * 100)}%` : null,
    receivables: await getOpenSummary("invoice"),
    payables: await getOpenSummary("bill"),
    monthly: monthly.map((m) => ({
      ...m,
      label: `${MONTH_NAMES[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(0, 4)}`,
      isLoss: m.net < 0
    })),
    pageData: { monthly: fillMonths(monthly, from, to) },
    recentEntries: (await listJournalEntries({ page: 1, limit: 6 })).items,
    overdueInvoices: await listOverdue("invoice"),
    overdueBills: await listOverdue("bill")
  });
};
