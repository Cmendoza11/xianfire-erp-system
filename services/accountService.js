import { Op, QueryTypes } from "sequelize";
import { sequelize, Account, JournalLine, PeriodClose } from "../models/index.js";
import { urls } from "../routes/urls.js";
import {
  AccountingValidationError,
  accountTypeLabel,
  defaultNormalBalance,
  isAccountType
} from "./accountTypes.js";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CASH_FLOW_CATEGORIES = [
  { value: "operating", label: "Operating" },
  { value: "investing", label: "Investing" },
  { value: "financing", label: "Financing" }
];

const ACCOUNT_SQL = `
  SELECT a.*,
    COALESCE(SUM(l.debit), 0) AS total_debit,
    COALESCE(SUM(l.credit), 0) AS total_credit
  FROM accounting_account a
  LEFT JOIN accounting_journal_line l ON l.account_id = a.accounting_account_id
`;

const TYPE_ORDER = `CASE a.type WHEN 'asset' THEN 1 WHEN 'liability' THEN 2 WHEN 'equity' THEN 3 WHEN 'revenue' THEN 4 ELSE 5 END`;

export function toAccount(row) {
  if (!row) return null;
  const totalDebit = Number(row.total_debit ?? 0);
  const totalCredit = Number(row.total_credit ?? 0);
  return {
    accountingAccountId: row.accounting_account_id,
    uuid: row.uuid,
    code: row.code,
    name: row.name,
    type: row.type,
    typeLabel: accountTypeLabel(row.type),
    normalBalance: row.normal_balance,
    description: row.description,
    status: Number(row.status),
    isCash: Boolean(Number(row.is_cash)),
    cashFlowCategory: row.cash_flow_category,
    totalDebit,
    totalCredit,
    balance: row.normal_balance === "debit" ? totalDebit - totalCredit : totalCredit - totalDebit,
    editUrl: urls.accountingAccountEdit(row.uuid),
    ledgerUrl: `${urls.reportGeneralLedger}?account=${row.uuid}`,
    updateApi: urls.updateAccountingAccount(row.uuid),
    deleteApi: urls.deleteAccountingAccount(row.uuid)
  };
}

export async function getAccount(uuid) {
  if (!uuid || !UUID_PATTERN.test(uuid)) return null;
  const rows = await sequelize.query(
    `${ACCOUNT_SQL} WHERE a.uuid = ? GROUP BY a.accounting_account_id`,
    { replacements: [uuid], type: QueryTypes.SELECT }
  );
  return toAccount(rows[0]);
}

export async function listAccounts({ includeInactive = true } = {}) {
  const where = includeInactive ? "" : "WHERE a.status = 1";
  const rows = await sequelize.query(
    `${ACCOUNT_SQL} ${where} GROUP BY a.accounting_account_id ORDER BY ${TYPE_ORDER}, a.code`,
    { type: QueryTypes.SELECT }
  );
  return rows.map(toAccount);
}

function normalize(data, current) {
  const code = String(data.code ?? current?.code ?? "").trim();
  const name = String(data.name ?? current?.name ?? "").trim();
  const type = data.type ?? current?.type;
  if (!code) {
    throw new AccountingValidationError("Account code is required");
  }
  if (!name) {
    throw new AccountingValidationError("Account name is required");
  }
  if (!isAccountType(type)) {
    throw new AccountingValidationError("Invalid account type");
  }
  // Changing the type resets the normal balance to that type's default unless one was sent explicitly.
  const normalBalance =
    data.normal_balance ||
    (data.type && data.type !== current?.type ? defaultNormalBalance(type) : current?.normal_balance) ||
    defaultNormalBalance(type);
  if (normalBalance !== "debit" && normalBalance !== "credit") {
    throw new AccountingValidationError("Normal balance must be debit or credit");
  }
  const status =
    data.status === undefined
      ? current?.status ?? 1
      : [1, "1", true, "true"].includes(data.status)
        ? 1
        : 0;
  const isCash =
    data.is_cash === undefined
      ? Boolean(Number(current?.is_cash ?? 0))
      : [1, "1", true, "true", "on"].includes(data.is_cash);
  if (isCash && type !== "asset") {
    throw new AccountingValidationError("Only asset accounts can be cash or bank accounts");
  }
  const cashFlowCategory = data.cash_flow_category ?? current?.cash_flow_category ?? "operating";
  if (!CASH_FLOW_CATEGORIES.some((c) => c.value === cashFlowCategory)) {
    throw new AccountingValidationError("Invalid cash flow category");
  }
  return {
    code,
    name,
    type,
    normal_balance: normalBalance,
    description:
      data.description === undefined ? current?.description ?? null : data.description || null,
    status,
    is_cash: isCash,
    cash_flow_category: cashFlowCategory
  };
}

async function assertCodeAvailable(code, exceptId) {
  const where = { code };
  if (exceptId) {
    where.accounting_account_id = { [Op.ne]: exceptId };
  }
  if (await Account.findOne({ where, attributes: ["accounting_account_id"] })) {
    throw new AccountingValidationError(`Account code ${code} is already used by another account`);
  }
}

export async function createAccount(data) {
  const row = normalize(data ?? {});
  await assertCodeAvailable(row.code);
  const account = await Account.create(row);
  return account.get({ plain: true });
}

export async function updateAccount(uuid, data) {
  const current = UUID_PATTERN.test(uuid) ? await Account.findOne({ where: { uuid } }) : null;
  if (!current) {
    throw new AccountingValidationError("Account not found");
  }
  const row = normalize(data ?? {}, current.get({ plain: true }));
  await assertCodeAvailable(row.code, current.accounting_account_id);
  await current.update(row);
  return current.get({ plain: true });
}

export async function deleteAccount(uuid) {
  const account = UUID_PATTERN.test(uuid) ? await Account.findOne({ where: { uuid } }) : null;
  if (!account) {
    throw new AccountingValidationError("Account not found");
  }
  const used = await JournalLine.findOne({
    where: { account_id: account.accounting_account_id },
    attributes: ["accounting_journal_line_id"]
  });
  if (used) {
    throw new AccountingValidationError(
      `Account ${account.code} - ${account.name} has journal entries and cannot be deleted. Set it to inactive instead.`
    );
  }
  if (await PeriodClose.findOne({ where: { retained_earnings_account_id: account.accounting_account_id } })) {
    throw new AccountingValidationError(
      `Account ${account.code} - ${account.name} received a fiscal year closing and cannot be deleted.`
    );
  }
  const plain = account.get({ plain: true });
  await account.destroy();
  return plain;
}
