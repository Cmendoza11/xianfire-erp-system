import { urls } from "../routes/urls.js";
import { AccountingValidationError } from "../services/accountTypes.js";
import { listAccounts } from "../services/accountService.js";
import { logAudit } from "../services/auditService.js";
import { closeFiscalYear, getLockDate, listFiscalYears, reopenFiscalYear } from "../services/periodService.js";
import { formatEntryNumber, getAccountingSettings } from "../services/settingService.js";

const DEFAULT_RETAINED_EARNINGS_CODE = "3200";

function sendError(res, e) {
  if (e instanceof AccountingValidationError) {
    return res.status(400).json({ error: { status: 400, message: e.message } });
  }
  throw e;
}

export const periodClosingPage = async (req, res) => {
  const equityAccounts = (await listAccounts({ includeInactive: false })).filter((a) => a.type === "equity");
  const hasDefault = equityAccounts.some((a) => a.code === DEFAULT_RETAINED_EARNINGS_CODE);
  res.render("periodClosing", {
    title: "Period Closing",
    activeMenu: "periodClosing",
    urls,
    lockDate: await getLockDate(),
    years: (await listFiscalYears()).reverse(),
    equityAccounts: equityAccounts.map((a, i) => ({
      uuid: a.uuid,
      label: `${a.code} - ${a.name}`,
      selected: hasDefault ? a.code === DEFAULT_RETAINED_EARNINGS_CODE : i === 0
    }))
  });
};

export const closePeriod = async (req, res) => {
  try {
    const { year, netIncome, entry, retained } = await closeFiscalYear({
      start: String(req.body.fiscal_year_start ?? ""),
      retainedEarningsUuid: String(req.body.retained_earnings_account ?? ""),
      adminUserId: req.adminUser?.admin_user_id
    });
    const { entryPrefix } = await getAccountingSettings();
    const entryText = entry
      ? ` with closing entry ${formatEntryNumber(entry.accounting_journal_entry_id, entryPrefix)}`
      : " (no revenue or expense activity, no closing entry needed)";
    await logAudit(req, {
      action: "period.close",
      entityType: "fiscal_year",
      entityId: year.start,
      summary: `Closed ${year.label} (${year.start} to ${year.end}), ${netIncome < 0 ? "net loss" : "net income"} ${Math.abs(netIncome).toFixed(2)} to ${retained.code} - ${retained.name}${entryText}`
    });
    res.json({ data: { fiscalYear: year.label, lockDate: year.end } });
  } catch (e) {
    sendError(res, e);
  }
};

export const reopenPeriod = async (req, res) => {
  try {
    const { year } = await reopenFiscalYear({ start: String(req.body.fiscal_year_start ?? "") });
    await logAudit(req, {
      action: "period.reopen",
      entityType: "fiscal_year",
      entityId: year.start,
      summary: `Reopened ${year.label} (${year.start} to ${year.end}); its closing entry was removed`
    });
    res.json({ data: { fiscalYear: year.label, lockDate: await getLockDate() } });
  } catch (e) {
    sendError(res, e);
  }
};
