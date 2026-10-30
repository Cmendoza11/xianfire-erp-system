import { QueryTypes, Transaction } from "sequelize";
import { sequelize, Account, BankReconciliation, JournalLine } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { UUID_PATTERN } from "./accountService.js";
import { AccountingValidationError } from "./accountTypes.js";
import { parseDate } from "./dateUtils.js";
import { formatEntryNumber, getAccountingSettings } from "./settingService.js";

const cents = (value) => Math.round(Number(value ?? 0) * 100);
const pesos = (value) => value / 100;

async function findReconciliation(uuid, transaction) {
  if (!uuid || !UUID_PATTERN.test(uuid)) return null;
  return BankReconciliation.findOne({
    where: { uuid },
    transaction,
    lock: transaction ? Transaction.LOCK.UPDATE : undefined
  });
}

// Book balance of everything cleared up to and including this reconciliation.
async function clearedBalanceCents(rec, transaction) {
  const [row] = await sequelize.query(
    `SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS balance
     FROM accounting_journal_line l
     INNER JOIN bank_reconciliation r ON r.bank_reconciliation_id = l.cleared_reconciliation_id
     WHERE l.account_id = :account
       AND (r.bank_reconciliation_id = :rec OR (r.status = 'completed' AND r.statement_date <= :date))`,
    {
      replacements: { account: rec.account_id, rec: rec.bank_reconciliation_id, date: rec.statement_date },
      type: QueryTypes.SELECT,
      transaction
    }
  );
  return cents(row.balance);
}

export async function listReconciliations() {
  const rows = await sequelize.query(
    `SELECT r.*, DATE_FORMAT(r.statement_date, '%Y-%m-%d') AS statement_date_s, a.code, a.name,
       u.full_name AS completed_by_name
     FROM bank_reconciliation r
     INNER JOIN accounting_account a ON a.accounting_account_id = r.account_id
     LEFT JOIN admin_user u ON u.admin_user_id = r.completed_by
     ORDER BY r.statement_date DESC, r.bank_reconciliation_id DESC`,
    { type: QueryTypes.SELECT }
  );
  return rows.map((r) => ({
    uuid: r.uuid,
    account: `${r.code} - ${r.name}`,
    statementDate: r.statement_date_s,
    statementBalance: Number(r.statement_balance),
    status: r.status,
    isDraft: r.status === "draft",
    completedBy: r.completed_by_name,
    completedAt: r.completed_at,
    viewUrl: urls.reconciliationView(r.uuid)
  }));
}

export async function startReconciliation(data, adminUserId) {
  const account =
    data?.account && UUID_PATTERN.test(data.account)
      ? await Account.findOne({ where: { uuid: data.account, is_cash: true }, raw: true })
      : null;
  if (!account) {
    throw new AccountingValidationError("Select a cash or bank account");
  }
  const statementDate = parseDate(String(data.statement_date ?? "").trim());
  if (!statementDate) {
    throw new AccountingValidationError("A valid statement date is required");
  }
  if (!Number.isFinite(Number(data.statement_balance)) || String(data.statement_balance).trim() === "") {
    throw new AccountingValidationError("Enter the ending balance shown on the bank statement");
  }
  if (await BankReconciliation.findOne({ where: { account_id: account.accounting_account_id, status: "draft" } })) {
    throw new AccountingValidationError(`${account.code} - ${account.name} already has a reconciliation in progress`);
  }
  const latest = await BankReconciliation.findOne({
    where: { account_id: account.accounting_account_id, status: "completed" },
    order: [["statement_date", "DESC"]],
    raw: true
  });
  if (latest && statementDate <= latest.statement_date) {
    throw new AccountingValidationError(`The statement date must be after the last reconciled statement (${latest.statement_date})`);
  }
  const rec = await BankReconciliation.create({
    account_id: account.accounting_account_id,
    statement_date: statementDate,
    statement_balance: pesos(cents(data.statement_balance)).toFixed(2),
    created_by: adminUserId ?? null
  });
  return { rec: rec.get({ plain: true }), account };
}

export async function getReconciliation(uuid) {
  const rec = await findReconciliation(uuid);
  if (!rec) return null;
  const account = await Account.findByPk(rec.account_id, { raw: true });
  const { entryPrefix } = await getAccountingSettings();
  const isDraft = rec.status === "draft";
  // A draft shows everything still open up to the statement date; a completed one shows what it cleared.
  const lines = await sequelize.query(
    `SELECT l.accounting_journal_line_id, l.debit, l.credit, l.description, l.cleared_reconciliation_id,
       e.accounting_journal_entry_id, e.uuid AS entry_uuid, e.reference, e.description AS entry_description,
       DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entry_date
     FROM accounting_journal_line l
     INNER JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = l.journal_entry_id
     WHERE l.account_id = :account AND e.entry_date <= :date
       AND ${isDraft ? "(l.cleared_reconciliation_id IS NULL OR l.cleared_reconciliation_id = :rec)" : "l.cleared_reconciliation_id = :rec"}
     ORDER BY e.entry_date, e.accounting_journal_entry_id, l.sort_order`,
    {
      replacements: { account: rec.account_id, date: rec.statement_date, rec: rec.bank_reconciliation_id },
      type: QueryTypes.SELECT
    }
  );
  const cleared = await clearedBalanceCents(rec);
  const statement = cents(rec.statement_balance);
  const toLine = (l) => ({
    id: l.accounting_journal_line_id,
    date: l.entry_date,
    entryNumber: formatEntryNumber(l.accounting_journal_entry_id, entryPrefix),
    entryUrl: urls.accountingJournalView(l.entry_uuid),
    reference: l.reference,
    description: l.description || l.entry_description,
    deposit: Number(l.debit),
    withdrawal: Number(l.credit),
    cleared: l.cleared_reconciliation_id === rec.bank_reconciliation_id
  });
  return {
    uuid: rec.uuid,
    account: `${account.code} - ${account.name}`,
    statementDate: rec.statement_date,
    statementBalance: pesos(statement),
    status: rec.status,
    isDraft,
    lines: lines.map(toLine),
    clearedBalance: pesos(cleared),
    difference: pesos(statement - cleared),
    canComplete: isDraft && statement === cleared,
    toggleApi: urls.toggleReconciliationLine(rec.uuid),
    completeApi: urls.completeReconciliation(rec.uuid),
    undoApi: urls.undoReconciliation(rec.uuid),
    deleteApi: urls.deleteReconciliation(rec.uuid)
  };
}

export async function toggleLine(uuid, data) {
  return sequelize.transaction(async (transaction) => {
    const rec = await findReconciliation(uuid, transaction);
    if (!rec || rec.status !== "draft") {
      throw new AccountingValidationError("Only a reconciliation in progress can be changed");
    }
    const lineId = Number(data?.line);
    const [line] = await sequelize.query(
      `SELECT l.accounting_journal_line_id, l.cleared_reconciliation_id
       FROM accounting_journal_line l
       INNER JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = l.journal_entry_id
       WHERE l.accounting_journal_line_id = ? AND l.account_id = ? AND e.entry_date <= ?`,
      { replacements: [lineId, rec.account_id, rec.statement_date], type: QueryTypes.SELECT, transaction }
    );
    if (!line || (line.cleared_reconciliation_id && line.cleared_reconciliation_id !== rec.bank_reconciliation_id)) {
      throw new AccountingValidationError("This transaction cannot be cleared in this reconciliation");
    }
    const cleared = Boolean(data.cleared);
    await JournalLine.update(
      { cleared_reconciliation_id: cleared ? rec.bank_reconciliation_id : null },
      { where: { accounting_journal_line_id: lineId }, transaction }
    );
    const clearedCents = await clearedBalanceCents(rec, transaction);
    const statement = cents(rec.statement_balance);
    return { clearedBalance: pesos(clearedCents), difference: pesos(statement - clearedCents), canComplete: statement === clearedCents };
  });
}

export async function completeReconciliation(uuid, adminUserId) {
  return sequelize.transaction(async (transaction) => {
    const rec = await findReconciliation(uuid, transaction);
    if (!rec || rec.status !== "draft") {
      throw new AccountingValidationError("Only a reconciliation in progress can be completed");
    }
    const difference = cents(rec.statement_balance) - (await clearedBalanceCents(rec, transaction));
    if (difference !== 0) {
      throw new AccountingValidationError(`The difference must be zero before completing (currently ${pesos(difference).toFixed(2)})`);
    }
    await rec.update({ status: "completed", completed_by: adminUserId ?? null, completed_at: new Date() }, { transaction });
    return rec.get({ plain: true });
  });
}

// Reopens the latest completed reconciliation of an account so it can be corrected.
export async function undoReconciliation(uuid) {
  return sequelize.transaction(async (transaction) => {
    const rec = await findReconciliation(uuid, transaction);
    if (!rec || rec.status !== "completed") {
      throw new AccountingValidationError("Only a completed reconciliation can be reopened");
    }
    const newerOrDraft = await sequelize.query(
      `SELECT 1 FROM bank_reconciliation WHERE account_id = ? AND bank_reconciliation_id <> ?
         AND (status = 'draft' OR statement_date > ?) LIMIT 1`,
      { replacements: [rec.account_id, rec.bank_reconciliation_id, rec.statement_date], type: QueryTypes.SELECT, transaction }
    );
    if (newerOrDraft.length > 0) {
      throw new AccountingValidationError("Only the latest reconciliation can be reopened, and only when none is in progress");
    }
    await rec.update({ status: "draft", completed_by: null, completed_at: null }, { transaction });
    return rec.get({ plain: true });
  });
}

export async function deleteReconciliation(uuid) {
  const rec = await findReconciliation(uuid);
  if (!rec || rec.status !== "draft") {
    throw new AccountingValidationError("Only a reconciliation in progress can be deleted");
  }
  const plain = rec.get({ plain: true });
  // Its ticked lines are released by ON DELETE SET NULL.
  await rec.destroy();
  return plain;
}

export async function reconciliationAccountOptions() {
  const rows = await Account.findAll({ where: { is_cash: true, status: 1 }, order: [["code", "ASC"]], raw: true });
  return rows.map((a) => ({ uuid: a.uuid, label: `${a.code} - ${a.name}` }));
}
