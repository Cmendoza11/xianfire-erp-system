import { urls } from "../routes/urls.js";
import { diffFields, logAudit } from "../services/auditService.js";
import { AccountingValidationError, ACCOUNT_TYPES } from "../services/accountTypes.js";
import {
  CASH_FLOW_CATEGORIES,
  createAccount as createAccountRecord,
  deleteAccount as deleteAccountRecord,
  getAccount,
  listAccounts,
  updateAccount as updateAccountRecord
} from "../services/accountService.js";

const accountLinks = (uuid) => [
  { rel: "grid", href: urls.accountingAccountGrid, action: "GET", types: ["text/xml"] },
  { rel: "edit", href: urls.accountingAccountEdit(uuid), action: "GET", types: ["text/xml"] }
];

// Form defaults for a new account: assets carry a debit balance and start active.
const formValues = (account) => ({
  code: account?.code ?? "",
  name: account?.name ?? "",
  type: account?.type ?? "asset",
  normalBalance: account?.normalBalance ?? "debit",
  status: String(account?.status ?? 1),
  description: account?.description ?? "",
  isCash: account?.isCash ?? false,
  cashFlowCategory: account?.cashFlowCategory ?? "operating"
});

function sendError(res, e) {
  if (e instanceof AccountingValidationError) {
    return res.status(400).json({ error: { status: 400, message: e.message } });
  }
  throw e;
}

export const accountGrid = async (req, res) => {
  res.render("accountGrid", {
    title: "Chart of Accounts",
    activeMenu: "accounts",
    urls,
    accounts: await listAccounts({ includeInactive: true }),
    types: ACCOUNT_TYPES
  });
};

export const accountNew = (req, res) => {
  res.render("accountForm", {
    title: "Create a new account",
    activeMenu: "accounts",
    urls,
    account: null,
    values: formValues(null),
    types: ACCOUNT_TYPES,
    cashFlowCategories: CASH_FLOW_CATEGORIES,
    form: { method: "POST", action: urls.createAccountingAccount }
  });
};

export const accountEdit = async (req, res, next) => {
  const account = await getAccount(req.params.id);
  if (!account) return next();
  res.render("accountForm", {
    title: `${account.code} - ${account.name}`,
    activeMenu: "accounts",
    urls,
    account,
    values: formValues(account),
    types: ACCOUNT_TYPES,
    cashFlowCategories: CASH_FLOW_CATEGORIES,
    form: { method: "PATCH", action: urls.updateAccountingAccount(account.uuid) }
  });
};

const AUDITED_FIELDS = [
  "code", "name", "type", "normal_balance", "description", "status", "is_cash", "cash_flow_category"
];

export const createAccount = async (req, res) => {
  try {
    const account = await createAccountRecord(req.body);
    await logAudit(req, {
      action: "account.create",
      entityType: "account",
      entityId: account.uuid,
      summary: `Created account ${account.code} - ${account.name} (${account.type}, ${account.normal_balance})`
    });
    res.json({ data: { ...account, links: accountLinks(account.uuid) } });
  } catch (e) {
    sendError(res, e);
  }
};

export const updateAccount = async (req, res) => {
  try {
    const before = await getAccount(req.params.id);
    const account = await updateAccountRecord(req.params.id, req.body);
    const changes = diffFields(
      before && {
        ...before,
        normal_balance: before.normalBalance,
        is_cash: before.isCash,
        cash_flow_category: before.cashFlowCategory
      },
      account,
      AUDITED_FIELDS
    );
    if (Object.keys(changes).length > 0) {
      await logAudit(req, {
        action: "account.update",
        entityType: "account",
        entityId: account.uuid,
        summary: `Updated account ${account.code} - ${account.name}: ${Object.entries(changes)
          .map(([field, { from, to }]) => `${field} "${from ?? ""}" → "${to ?? ""}"`)
          .join(", ")}`,
        details: changes
      });
    }
    res.json({ data: { ...account, links: accountLinks(account.uuid) } });
  } catch (e) {
    sendError(res, e);
  }
};

export const deleteAccount = async (req, res) => {
  try {
    const account = await deleteAccountRecord(req.params.id);
    await logAudit(req, {
      action: "account.delete",
      entityType: "account",
      entityId: account.uuid,
      summary: `Deleted account ${account.code} - ${account.name}`
    });
    res.json({ data: account });
  } catch (e) {
    sendError(res, e);
  }
};
