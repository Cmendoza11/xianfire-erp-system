import { QueryTypes } from "sequelize";
import { sequelize, Account, JournalEntry, JournalLine, PeriodClose } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { UUID_PATTERN } from "./accountService.js";
import { AccountingValidationError } from "./accountTypes.js";
import {
  fiscalYearEnd,
  fiscalYearLabel,
  fiscalYearStart,
  nextFiscalYearStart,
  today
} from "./dateUtils.js";
import { accountTotals, netIncomeCents } from "./reportService.js";
import { formatEntryNumber, getAccountingSettings } from "./settingService.js";

// The books are locked through the end of the latest closed fiscal year (null when none is closed).
export async function getLockDate() {
  const latest = await PeriodClose.findOne({
    order: [["fiscal_year_end", "DESC"]],
    attributes: ["fiscal_year_end"],
    raw: true
  });
  return latest?.fiscal_year_end ?? null;
}

export async function assertPeriodOpen(date, lockDate) {
  const lock = lockDate === undefined ? await getLockDate() : lockDate;
  if (lock && date <= lock) {
    throw new AccountingValidationError(
      `The books are closed through ${lock}. Use a date after ${lock}, or reopen the fiscal year in Period Closing.`
    );
  }
}

export async function hasClosedPeriods() {
  return (await PeriodClose.count()) > 0;
}

// Every fiscal year from the one holding the first entry up to the current one, oldest first.
export async function listFiscalYears() {
  const { fiscalYearStartMonth, entryPrefix } = await getAccountingSettings();
  const [{ first }] = await sequelize.query(
    "SELECT DATE_FORMAT(MIN(entry_date), '%Y-%m-%d') AS first FROM accounting_journal_entry",
    { type: QueryTypes.SELECT }
  );
  const closes = await sequelize.query(
    `SELECT c.fiscal_year_start, c.fiscal_year_end, c.journal_entry_id, c.created_at,
       e.uuid AS entry_uuid, u.full_name AS closed_by_name, a.code AS re_code, a.name AS re_name
     FROM accounting_period_close c
     LEFT JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = c.journal_entry_id
     LEFT JOIN admin_user u ON u.admin_user_id = c.closed_by
     LEFT JOIN accounting_account a ON a.accounting_account_id = c.retained_earnings_account_id
     ORDER BY c.fiscal_year_start`,
    { type: QueryTypes.SELECT }
  );
  const closedByStart = new Map(closes.map((c) => [String(c.fiscal_year_start), c]));
  const todayDate = today();
  const currentStart = fiscalYearStart(todayDate, fiscalYearStartMonth);
  const starts = [first ? fiscalYearStart(first, fiscalYearStartMonth) : currentStart, ...closedByStart.keys()];
  let start = starts.sort()[0] < currentStart ? starts.sort()[0] : currentStart;

  const years = [];
  let earlierAllClosed = true;
  while (start <= currentStart) {
    const end = fiscalYearEnd(start);
    const close = closedByStart.get(start);
    const ended = end < todayDate;
    const netIncome = netIncomeCents(await accountTotals({ from: start, to: end, excludeClosing: true }));
    years.push({
      start,
      end,
      label: fiscalYearLabel(start),
      netIncome: netIncome / 100,
      status: close ? "closed" : ended ? "open" : "current",
      canClose: !close && ended && earlierAllClosed,
      canReopen: false,
      closedAt: close?.created_at ?? null,
      closedBy: close?.closed_by_name ?? null,
      retainedEarnings: close ? `${close.re_code} - ${close.re_name}` : null,
      closingEntry: close?.journal_entry_id
        ? { number: formatEntryNumber(close.journal_entry_id, entryPrefix), url: urls.accountingJournalView(close.entry_uuid) }
        : null
    });
    if (!close) earlierAllClosed = false;
    start = nextFiscalYearStart(start);
  }
  // Only the most recent closed year can be reopened, so later years never sit on an open one.
  const lastClosed = [...years].reverse().find((y) => y.status === "closed");
  if (lastClosed) lastClosed.canReopen = true;
  return years;
}

export async function closeFiscalYear({ start, retainedEarningsUuid, adminUserId }) {
  const year = (await listFiscalYears()).find((y) => y.start === start);
  if (!year) {
    throw new AccountingValidationError("Fiscal year not found");
  }
  if (!year.canClose) {
    throw new AccountingValidationError(
      year.status === "closed"
        ? `${year.label} is already closed`
        : year.status === "current"
          ? `${year.label} has not ended yet (it ends on ${year.end})`
          : "Close the earlier fiscal years first"
    );
  }
  const retained =
    retainedEarningsUuid && UUID_PATTERN.test(retainedEarningsUuid)
      ? await Account.findOne({ where: { uuid: retainedEarningsUuid }, raw: true })
      : null;
  if (!retained || retained.type !== "equity" || Number(retained.status) !== 1) {
    throw new AccountingValidationError("Select an active equity account for retained earnings");
  }

  // Each revenue and expense balance for the year is reversed; the difference (net income or
  // loss) lands in retained earnings, so the closing entry always balances.
  const totals = await accountTotals({ from: year.start, to: year.end, excludeClosing: true });
  const lines = [];
  for (const row of totals) {
    if (row.type !== "revenue" && row.type !== "expense") continue;
    const net = row.debit - row.credit;
    if (net === 0) continue;
    lines.push({
      account_id: row.accountingAccountId,
      description: "Close to retained earnings",
      debit: net < 0 ? ((-net) / 100).toFixed(2) : "0.00",
      credit: net > 0 ? (net / 100).toFixed(2) : "0.00"
    });
  }
  const netIncome = netIncomeCents(totals);
  if (netIncome !== 0) {
    lines.push({
      account_id: retained.accounting_account_id,
      description: netIncome > 0 ? "Net income for the year" : "Net loss for the year",
      debit: netIncome < 0 ? ((-netIncome) / 100).toFixed(2) : "0.00",
      credit: netIncome > 0 ? (netIncome / 100).toFixed(2) : "0.00"
    });
  }

  return sequelize.transaction(async (transaction) => {
    let entry = null;
    if (lines.length > 0) {
      entry = await JournalEntry.create(
        {
          entry_date: year.end,
          reference: `CLOSE-${year.end.slice(0, 4)}`,
          description: `Closing entry for ${year.label}`,
          created_by: adminUserId ?? null,
          entry_type: "closing"
        },
        { transaction }
      );
      await JournalLine.bulkCreate(
        lines.map((line, index) => ({ ...line, sort_order: index, journal_entry_id: entry.accounting_journal_entry_id })),
        { transaction }
      );
    }
    await PeriodClose.create(
      {
        fiscal_year_start: year.start,
        fiscal_year_end: year.end,
        journal_entry_id: entry?.accounting_journal_entry_id ?? null,
        retained_earnings_account_id: retained.accounting_account_id,
        closed_by: adminUserId ?? null
      },
      { transaction }
    );
    return { year, netIncome: netIncome / 100, entry: entry?.get({ plain: true }) ?? null, retained };
  });
}

export async function reopenFiscalYear({ start }) {
  const year = (await listFiscalYears()).find((y) => y.start === start);
  if (!year || year.status !== "closed") {
    throw new AccountingValidationError("This fiscal year is not closed");
  }
  if (!year.canReopen) {
    throw new AccountingValidationError("Reopen the later closed fiscal years first");
  }
  return sequelize.transaction(async (transaction) => {
    const close = await PeriodClose.findOne({ where: { fiscal_year_start: start }, transaction });
    const entryId = close.journal_entry_id;
    await close.destroy({ transaction });
    if (entryId) {
      await JournalEntry.destroy({ where: { accounting_journal_entry_id: entryId }, transaction });
    }
    return { year };
  });
}
