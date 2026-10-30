import { Op, QueryTypes } from "sequelize";
import { sequelize, Account, JournalEntry, JournalLine } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { toAccount, UUID_PATTERN } from "./accountService.js";
import { AccountingValidationError, toCents } from "./accountTypes.js";
import { assertPeriodOpen, getLockDate } from "./periodService.js";
import { formatEntryNumber, getAccountingSettings, getSalesPurchaseSettings } from "./settingService.js";
import { parseDate } from "./dateUtils.js";

// Correlated subqueries (not joins) keep the GROUP BY on the entry's primary key valid.
const ENTRY_SQL = `
  SELECT e.accounting_journal_entry_id, e.uuid, e.reference, e.description, e.created_at,
    e.entry_type, e.reversal_of_id,
    DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entry_date,
    (SELECT o.uuid FROM accounting_journal_entry o WHERE o.accounting_journal_entry_id = e.reversal_of_id) AS reversal_of_uuid,
    (SELECT o.entry_type FROM accounting_journal_entry o WHERE o.accounting_journal_entry_id = e.reversal_of_id) AS reversal_of_type,
    (SELECT COUNT(*) FROM accounting_journal_line cl
       INNER JOIN bank_reconciliation br ON br.bank_reconciliation_id = cl.cleared_reconciliation_id
       WHERE cl.journal_entry_id = e.accounting_journal_entry_id AND br.status = 'completed') AS reconciled_lines,
    (SELECT r.accounting_journal_entry_id FROM accounting_journal_entry r WHERE r.reversal_of_id = e.accounting_journal_entry_id LIMIT 1) AS reversed_by_id,
    (SELECT r.uuid FROM accounting_journal_entry r WHERE r.reversal_of_id = e.accounting_journal_entry_id LIMIT 1) AS reversed_by_uuid,
    (SELECT u.full_name FROM admin_user u WHERE u.admin_user_id = e.created_by) AS created_by_name,
    (SELECT u.email FROM admin_user u WHERE u.admin_user_id = e.created_by) AS created_by_email,
    COALESCE(SUM(l.debit), 0) AS total_debit,
    COALESCE(SUM(l.credit), 0) AS total_credit
  FROM accounting_journal_entry e
  LEFT JOIN accounting_journal_line l ON l.journal_entry_id = e.accounting_journal_entry_id
`;

const ENTRY_TYPE_LABELS = {
  manual: "Manual",
  reversal: "Reversal",
  closing: "Closing",
  invoice: "Sales invoice",
  bill: "Supplier bill",
  receipt: "Payment received",
  disbursement: "Payment made"
};

// Entries owned by an invoice, bill or payment: they change only through that document.
export const DOCUMENT_ENTRY_TYPES = ["invoice", "bill", "receipt", "disbursement"];

function toEntry(row, entryPrefix) {
  if (!row) return null;
  const link = (id, uuid) =>
    id ? { number: formatEntryNumber(id, entryPrefix), url: urls.accountingJournalView(uuid) } : null;
  return {
    accountingJournalEntryId: row.accounting_journal_entry_id,
    uuid: row.uuid,
    entryNumber: formatEntryNumber(row.accounting_journal_entry_id, entryPrefix),
    entryDate: row.entry_date,
    reference: row.reference,
    description: row.description,
    entryType: row.entry_type,
    entryTypeLabel: ENTRY_TYPE_LABELS[row.entry_type] ?? row.entry_type,
    isClosing: row.entry_type === "closing",
    // Posted by a document, or the void reversal of one.
    isDocumentEntry:
      DOCUMENT_ENTRY_TYPES.includes(row.entry_type) || DOCUMENT_ENTRY_TYPES.includes(row.reversal_of_type),
    reconciled: Number(row.reconciled_lines ?? 0) > 0,
    reversalOf: link(row.reversal_of_id, row.reversal_of_uuid),
    reversedBy: link(row.reversed_by_id, row.reversed_by_uuid),
    createdBy: row.created_by_name || row.created_by_email || null,
    totalDebit: Number(row.total_debit ?? 0),
    totalCredit: Number(row.total_credit ?? 0),
    createdAt: row.created_at ? new Date(row.created_at) : null,
    viewUrl: urls.accountingJournalView(row.uuid),
    deleteApi: urls.deleteAccountingJournal(row.uuid),
    reverseApi: urls.reverseAccountingJournal(row.uuid)
  };
}

// Why an entry may not be deleted or reversed; null means the action is allowed.
function deleteBlocker(entry, lockDate) {
  if (entry.isClosing) return "Closing entries are removed by reopening the fiscal year in Period Closing.";
  if (entry.isDocumentEntry) {
    return "This entry belongs to an invoice, bill or payment. Void that document instead.";
  }
  if (entry.reconciled) {
    return "This entry has lines cleared in a completed bank reconciliation. Record a reversing entry instead.";
  }
  if (entry.reversedBy) return `This entry was reversed by ${entry.reversedBy.number}. Delete that reversing entry first.`;
  if (lockDate && entry.entryDate <= lockDate) {
    return `The books are closed through ${lockDate}. Record an adjusting entry in an open period instead.`;
  }
  return null;
}

function reverseBlocker(entry) {
  if (entry.isClosing) return "Closing entries cannot be reversed. Reopen the fiscal year instead.";
  if (entry.isDocumentEntry) {
    return "This entry belongs to an invoice, bill or payment. Void that document instead.";
  }
  if (entry.reversalOf) return "This entry is itself a reversal and cannot be reversed again.";
  if (entry.reversedBy) return `This entry was already reversed by ${entry.reversedBy.number}.`;
  return null;
}

async function loadLines(entryId) {
  const rows = await sequelize.query(
    `SELECT l.*, a.uuid AS account_uuid, a.code AS account_code, a.name AS account_name,
       a.type AS account_type, a.normal_balance AS account_normal_balance, a.status AS account_status
     FROM accounting_journal_line l
     INNER JOIN accounting_account a ON a.accounting_account_id = l.account_id
     WHERE l.journal_entry_id = ?
     ORDER BY l.sort_order, l.accounting_journal_line_id`,
    { replacements: [entryId], type: QueryTypes.SELECT }
  );
  return rows.map((row) => ({
    accountingJournalLineId: row.accounting_journal_line_id,
    description: row.description,
    debit: Number(row.debit),
    credit: Number(row.credit),
    account: toAccount({
      accounting_account_id: row.account_id,
      uuid: row.account_uuid,
      code: row.account_code,
      name: row.account_name,
      type: row.account_type,
      normal_balance: row.account_normal_balance,
      status: row.account_status
    })
  }));
}

async function findEntry(uuid) {
  if (!uuid || !UUID_PATTERN.test(uuid)) return null;
  const rows = await sequelize.query(
    `${ENTRY_SQL} WHERE e.uuid = ? GROUP BY e.accounting_journal_entry_id`,
    { replacements: [uuid], type: QueryTypes.SELECT }
  );
  if (!rows[0]) return null;
  const { entryPrefix } = await getAccountingSettings();
  return toEntry(rows[0], entryPrefix);
}

export async function getJournalEntry(uuid) {
  const entry = await findEntry(uuid);
  if (!entry) return null;
  const lockDate = await getLockDate();
  entry.lines = await loadLines(entry.accountingJournalEntryId);
  entry.lockDate = lockDate;
  entry.inClosedPeriod = Boolean(lockDate && entry.entryDate <= lockDate);
  entry.deleteBlockedReason = deleteBlocker(entry, lockDate);
  entry.reverseBlockedReason = reverseBlocker(entry);
  entry.sourceDocument = entry.isDocumentEntry ? await findSourceDocument(entry.accountingJournalEntryId) : null;
  return entry;
}

// The invoice or bill an entry was posted from (directly, through a payment, or as its void).
async function findSourceDocument(entryId) {
  const [row] = await sequelize.query(
    `SELECT i.uuid, i.kind, i.invoice_id FROM invoice i
     WHERE i.journal_entry_id = :id OR i.void_entry_id = :id
     UNION ALL
     SELECT i.uuid, i.kind, i.invoice_id FROM payment p
     INNER JOIN invoice i ON i.invoice_id = p.invoice_id
     WHERE p.journal_entry_id = :id OR p.void_entry_id = :id
     LIMIT 1`,
    { replacements: { id: entryId }, type: QueryTypes.SELECT }
  );
  if (!row) return null;
  const { invoicePrefix, billPrefix } = await getSalesPurchaseSettings();
  const isInvoice = row.kind === "invoice";
  return {
    label: isInvoice ? "Sales invoice" : "Supplier bill",
    number: formatEntryNumber(row.invoice_id, isInvoice ? invoicePrefix : billPrefix),
    url: isInvoice ? urls.invoiceView(row.uuid) : urls.billView(row.uuid)
  };
}

// Posts a balanced entry inside the caller's transaction. Lines carry integer cents so documents
// (invoices, bills, payments) cannot drift by rounding.
export async function postEntry(transaction, header, lines) {
  const debit = lines.reduce((sum, l) => sum + (l.debitCents || 0), 0);
  const credit = lines.reduce((sum, l) => sum + (l.creditCents || 0), 0);
  if (debit <= 0 || debit !== credit) {
    throw new AccountingValidationError("Internal posting error: the generated entry does not balance");
  }
  await assertPeriodOpen(header.entry_date);
  const entry = await JournalEntry.create(header, { transaction });
  await JournalLine.bulkCreate(
    lines
      .filter((l) => (l.debitCents || 0) > 0 || (l.creditCents || 0) > 0)
      .map((l, index) => ({
        journal_entry_id: entry.accounting_journal_entry_id,
        account_id: l.accountId,
        description: l.description ?? null,
        debit: ((l.debitCents || 0) / 100).toFixed(2),
        credit: ((l.creditCents || 0) / 100).toFixed(2),
        sort_order: index
      })),
    { transaction }
  );
  return entry.get({ plain: true });
}

// Posts the mirror image of an entry (debits become credits) inside the caller's transaction.
export async function postReversal(transaction, { originalId, entryDate, reference, description, createdBy }) {
  await assertPeriodOpen(entryDate);
  const lines = await JournalLine.findAll({
    where: { journal_entry_id: originalId },
    order: [["sort_order", "ASC"], ["accounting_journal_line_id", "ASC"]],
    raw: true,
    transaction
  });
  const entry = await JournalEntry.create(
    {
      entry_date: entryDate,
      reference,
      description,
      created_by: createdBy ?? null,
      entry_type: "reversal",
      reversal_of_id: originalId
    },
    { transaction }
  );
  await JournalLine.bulkCreate(
    lines.map((line) => ({
      journal_entry_id: entry.accounting_journal_entry_id,
      account_id: line.account_id,
      description: line.description,
      debit: line.credit,
      credit: line.debit,
      sort_order: line.sort_order
    })),
    { transaction }
  );
  return entry.get({ plain: true });
}

export async function listJournalEntries({ page = 1, limit = 20, keyword } = {}) {
  const safePage = Math.max(1, page || 1);
  const safeLimit = Math.min(Math.max(1, limit || 20), 100);
  const replacements = [];
  let where = "";
  if (keyword && keyword.trim()) {
    const like = `%${keyword.trim()}%`;
    replacements.push(like, like);
    where = "WHERE e.description LIKE ? OR e.reference LIKE ?";
  }
  const [{ total }] = await sequelize.query(
    `SELECT COUNT(*) AS total FROM accounting_journal_entry e ${where}`,
    { replacements, type: QueryTypes.SELECT }
  );
  const rows = await sequelize.query(
    `${ENTRY_SQL} ${where} GROUP BY e.accounting_journal_entry_id
     ORDER BY e.entry_date DESC, e.accounting_journal_entry_id DESC
     LIMIT ${safeLimit} OFFSET ${(safePage - 1) * safeLimit}`,
    { replacements, type: QueryTypes.SELECT }
  );
  const { entryPrefix } = await getAccountingSettings();
  return {
    items: rows.map((row) => toEntry(row, entryPrefix)),
    total: Number(total),
    page: safePage,
    limit: safeLimit,
    keyword: keyword ?? ""
  };
}

async function prepareLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new AccountingValidationError("A journal entry needs at least two lines");
  }
  const uuids = [...new Set(lines.map((l) => l?.account).filter(Boolean))];
  const accounts = uuids.length
    ? await Account.findAll({
        where: { uuid: { [Op.in]: uuids } },
        attributes: ["accounting_account_id", "uuid", "code", "name", "status"],
        raw: true
      })
    : [];
  const byUuid = new Map(accounts.map((a) => [a.uuid, a]));

  let totalDebit = 0;
  let totalCredit = 0;
  const prepared = lines.map((line, index) => {
    const n = index + 1;
    const account = byUuid.get(line?.account);
    if (!account) {
      throw new AccountingValidationError(`Line ${n}: select an account`);
    }
    if (Number(account.status) !== 1) {
      throw new AccountingValidationError(
        `Line ${n}: account ${account.code} - ${account.name} is inactive`
      );
    }
    const debit = toCents(line.debit || 0);
    const credit = toCents(line.credit || 0);
    if (Number.isNaN(debit) || Number.isNaN(credit)) {
      throw new AccountingValidationError(`Line ${n}: amounts must be positive numbers`);
    }
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      throw new AccountingValidationError(`Line ${n}: enter either a debit or a credit amount`);
    }
    totalDebit += debit;
    totalCredit += credit;
    return {
      account_id: account.accounting_account_id,
      description: line.description ? String(line.description).trim() : null,
      debit: (debit / 100).toFixed(2),
      credit: (credit / 100).toFixed(2),
      sort_order: index
    };
  });

  if (totalDebit !== totalCredit) {
    throw new AccountingValidationError(
      `Entry is not balanced: total debit ${(totalDebit / 100).toFixed(2)} vs total credit ${(
        totalCredit / 100
      ).toFixed(2)}`
    );
  }
  return prepared;
}

export async function createJournalEntry(data, adminUserId) {
  const description = String(data?.description ?? "").trim();
  if (!description) {
    throw new AccountingValidationError("Description is required");
  }
  const entryDate = parseDate(String(data?.entry_date ?? "").trim());
  if (!entryDate) {
    throw new AccountingValidationError("A valid entry date is required");
  }
  await assertPeriodOpen(entryDate);
  const lines = await prepareLines(data.lines ?? []);

  // Header and lines are written atomically: a half-saved entry would leave the ledger unbalanced.
  return sequelize.transaction(async (transaction) => {
    const entry = await JournalEntry.create(
      {
        entry_date: entryDate,
        reference: data.reference ? String(data.reference).trim() : null,
        description,
        created_by: adminUserId ?? null
      },
      { transaction }
    );
    await JournalLine.bulkCreate(
      lines.map((line) => ({ ...line, journal_entry_id: entry.accounting_journal_entry_id })),
      { transaction }
    );
    return entry.get({ plain: true });
  });
}

// Posts the mirror image of an entry (debits become credits) so a mistake is cancelled while both
// the original and the correction stay in the ledger.
export async function reverseJournalEntry(uuid, data, adminUserId) {
  const original = await findEntry(uuid);
  if (!original) {
    throw new AccountingValidationError("Journal entry not found");
  }
  const blocker = reverseBlocker(original);
  if (blocker) throw new AccountingValidationError(blocker);
  const entryDate = parseDate(String(data?.entry_date ?? "").trim());
  if (!entryDate) {
    throw new AccountingValidationError("A valid reversal date is required");
  }
  if (entryDate < original.entryDate) {
    throw new AccountingValidationError(
      `The reversal date cannot be earlier than the original entry date (${original.entryDate})`
    );
  }
  const reason = String(data?.reason ?? "").trim();
  const entry = await sequelize.transaction((transaction) =>
    postReversal(transaction, {
      originalId: original.accountingJournalEntryId,
      entryDate,
      reference: original.reference,
      description: `Reversal of ${original.entryNumber}: ${original.description}${reason ? ` (${reason})` : ""}`,
      createdBy: adminUserId
    })
  );
  return { entry, original };
}

export async function deleteJournalEntry(uuid) {
  const entry = await findEntry(uuid);
  if (!entry) {
    throw new AccountingValidationError("Journal entry not found");
  }
  const blocker = deleteBlocker(entry, await getLockDate());
  if (blocker) throw new AccountingValidationError(blocker);
  await JournalEntry.destroy({ where: { accounting_journal_entry_id: entry.accountingJournalEntryId } });
  return entry;
}
