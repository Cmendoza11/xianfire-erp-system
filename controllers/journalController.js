import { buildPagination, positiveInt } from "../helpers/pagination.js";
import { urls } from "../routes/urls.js";
import { AccountingValidationError } from "../services/accountTypes.js";
import { listAccounts } from "../services/accountService.js";
import { logAudit } from "../services/auditService.js";
import {
  createJournalEntry,
  deleteJournalEntry,
  getJournalEntry,
  listJournalEntries,
  reverseJournalEntry
} from "../services/journalService.js";
import { getLockDate } from "../services/periodService.js";
import { formatEntryNumber, getAccountingSettings } from "../services/settingService.js";
import { today } from "../services/dateUtils.js";

function sendError(res, e) {
  if (e instanceof AccountingValidationError) {
    return res.status(400).json({ error: { status: 400, message: e.message } });
  }
  throw e;
}

const entryLinks = (uuid) => [
  { rel: "grid", href: urls.accountingJournalGrid, action: "GET", types: ["text/xml"] },
  { rel: "view", href: urls.accountingJournalView(uuid), action: "GET", types: ["text/xml"] }
];

export const journalGrid = async (req, res) => {
  const entries = await listJournalEntries({
    page: positiveInt(req.query.page, 1),
    limit: positiveInt(req.query.limit, 20),
    keyword: typeof req.query.keyword === "string" ? req.query.keyword : ""
  });
  res.render("journalGrid", {
    title: "Journal Entries",
    activeMenu: "journal",
    urls,
    entries,
    pagination: buildPagination(entries)
  });
};

export const journalNew = async (req, res) => {
  const accounts = await listAccounts({ includeInactive: false });
  const lockDate = await getLockDate();
  res.render("journalNew", {
    title: "New journal entry",
    activeMenu: "journalNew",
    urls,
    lockDate,
    pageData: {
      action: urls.createAccountingJournal,
      gridUrl: urls.accountingJournalGrid,
      lockDate,
      accounts: accounts.map(({ uuid, code, name, typeLabel }) => ({ uuid, code, name, typeLabel }))
    }
  });
};

export const journalView = async (req, res, next) => {
  const entry = await getJournalEntry(req.params.id);
  if (!entry) return next();
  res.render("journalView", {
    title: entry.entryNumber,
    activeMenu: "journal",
    urls,
    entry,
    // A reversal cannot predate the entry it cancels.
    reverseDefaultDate: entry.entryDate > today() ? entry.entryDate : today()
  });
};

export const createJournal = async (req, res) => {
  try {
    const entry = await createJournalEntry(req.body, req.adminUser?.admin_user_id);
    const { entryPrefix } = await getAccountingSettings();
    const number = formatEntryNumber(entry.accounting_journal_entry_id, entryPrefix);
    const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
    const total = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
    await logAudit(req, {
      action: "journal.post",
      entityType: "journal_entry",
      entityId: entry.uuid,
      summary: `Posted ${number} (${entry.entry_date}) "${entry.description}" for ${total.toFixed(2)}`,
      details: { entryDate: entry.entry_date, reference: entry.reference, lines: lines.length }
    });
    res.json({ data: { ...entry, links: entryLinks(entry.uuid) } });
  } catch (e) {
    sendError(res, e);
  }
};

export const reverseJournal = async (req, res) => {
  try {
    const { entry, original } = await reverseJournalEntry(req.params.id, req.body, req.adminUser?.admin_user_id);
    const { entryPrefix } = await getAccountingSettings();
    const number = formatEntryNumber(entry.accounting_journal_entry_id, entryPrefix);
    await logAudit(req, {
      action: "journal.reverse",
      entityType: "journal_entry",
      entityId: original.uuid,
      summary: `Reversed ${original.entryNumber} with ${number} dated ${entry.entry_date}`,
      details: { reversalUuid: entry.uuid, reason: req.body?.reason || null }
    });
    res.json({ data: { ...entry, links: entryLinks(entry.uuid) } });
  } catch (e) {
    sendError(res, e);
  }
};

export const deleteJournal = async (req, res) => {
  try {
    const entry = await deleteJournalEntry(req.params.id);
    await logAudit(req, {
      action: "journal.delete",
      entityType: "journal_entry",
      entityId: entry.uuid,
      summary: `Deleted ${entry.entryNumber} (${entry.entryDate}) "${entry.description}" for ${entry.totalDebit.toFixed(2)}`,
      details: { entryDate: entry.entryDate, reference: entry.reference, entryType: entry.entryType }
    });
    res.json({ data: entry });
  } catch (e) {
    sendError(res, e);
  }
};
