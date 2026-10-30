import { urls } from "../routes/urls.js";
import { fiscalYearLabel, fiscalYearStart, today } from "../services/dateUtils.js";
import { getOpenSummary, listOverdue } from "../services/invoiceService.js";
import { listJournalEntries } from "../services/journalService.js";
import { getLockDate } from "../services/periodService.js";
import { getCashBalances, getIncomeStatement, getMonthlyResults } from "../services/reportService.js";
import { getAccountingSettings } from "../services/settingService.js";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const dashboardPage = async (req, res) => {
  const settings = await getAccountingSettings();
  const to = today();
  const from = fiscalYearStart(to, settings.fiscalYearStartMonth);
  const income = await getIncomeStatement({ from, to });
  const monthly = await getMonthlyResults({ from, to });
  const peak = Math.max(1, ...monthly.flatMap((m) => [m.revenue, m.expense]));
  res.render("dashboard", {
    title: "Dashboard",
    activeMenu: "dashboard",
    urls,
    company: settings.companyName,
    currency: settings.currency,
    fiscalYear: fiscalYearLabel(from),
    period: { from, to },
    lockDate: await getLockDate(),
    cash: await getCashBalances(to),
    revenue: income.revenue.total,
    expenses: income.expense.total,
    netIncome: income.netIncome,
    isLoss: income.isLoss,
    receivables: await getOpenSummary("invoice"),
    payables: await getOpenSummary("bill"),
    // Bar widths are percentages of the largest monthly figure.
    monthly: monthly.map((m) => ({
      ...m,
      label: `${MONTH_NAMES[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(0, 4)}`,
      revenueWidth: Math.round((Math.max(0, m.revenue) / peak) * 100),
      expenseWidth: Math.round((Math.max(0, m.expense) / peak) * 100),
      isLoss: m.net < 0
    })),
    recentEntries: (await listJournalEntries({ page: 1, limit: 6 })).items,
    overdueInvoices: await listOverdue("invoice"),
    overdueBills: await listOverdue("bill")
  });
};
