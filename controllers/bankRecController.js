import { urls } from "../routes/urls.js";
import { AccountingValidationError } from "../services/accountTypes.js";
import { logAudit } from "../services/auditService.js";
import {
  completeReconciliation as completeRecord,
  deleteReconciliation as deleteRecord,
  getReconciliation,
  listReconciliations,
  reconciliationAccountOptions,
  startReconciliation as startRecord,
  toggleLine,
  undoReconciliation as undoRecord
} from "../services/bankRecService.js";
import { today } from "../services/dateUtils.js";

function sendError(res, e) {
  if (e instanceof AccountingValidationError) {
    return res.status(400).json({ error: { status: 400, message: e.message } });
  }
  throw e;
}

export const reconciliationGrid = async (req, res) => {
  res.render("reconciliationGrid", {
    title: "Bank Reconciliation",
    activeMenu: "bankrec",
    urls,
    reconciliations: await listReconciliations(),
    accounts: await reconciliationAccountOptions(),
    today: today()
  });
};

export const reconciliationView = async (req, res, next) => {
  const rec = await getReconciliation(req.params.id);
  if (!rec) return next();
  res.render("reconciliationView", {
    title: `Reconciliation ${rec.account} ${rec.statementDate}`,
    activeMenu: "bankrec",
    urls,
    rec
  });
};

export const startReconciliation = async (req, res) => {
  try {
    const { rec, account } = await startRecord(req.body, req.adminUser?.admin_user_id);
    await logAudit(req, {
      action: "bankrec.start",
      entityType: "bank_reconciliation",
      entityId: rec.uuid,
      summary: `Started reconciliation of ${account.code} - ${account.name} for the statement of ${rec.statement_date} (${Number(rec.statement_balance).toFixed(2)})`
    });
    res.json({ data: { ...rec, viewUrl: urls.reconciliationView(rec.uuid) } });
  } catch (e) {
    sendError(res, e);
  }
};

export const toggleReconciliationLine = async (req, res) => {
  try {
    res.json({ data: await toggleLine(req.params.id, req.body) });
  } catch (e) {
    sendError(res, e);
  }
};

export const completeReconciliation = async (req, res) => {
  try {
    const rec = await completeRecord(req.params.id, req.adminUser?.admin_user_id);
    await logAudit(req, {
      action: "bankrec.complete",
      entityType: "bank_reconciliation",
      entityId: rec.uuid,
      summary: `Completed reconciliation for the statement of ${rec.statement_date} (${Number(rec.statement_balance).toFixed(2)})`
    });
    res.json({ data: {} });
  } catch (e) {
    sendError(res, e);
  }
};

export const undoReconciliation = async (req, res) => {
  try {
    const rec = await undoRecord(req.params.id);
    await logAudit(req, {
      action: "bankrec.undo",
      entityType: "bank_reconciliation",
      entityId: rec.uuid,
      summary: `Reopened reconciliation for the statement of ${rec.statement_date}`
    });
    res.json({ data: {} });
  } catch (e) {
    sendError(res, e);
  }
};

export const deleteReconciliation = async (req, res) => {
  try {
    const rec = await deleteRecord(req.params.id);
    await logAudit(req, {
      action: "bankrec.delete",
      entityType: "bank_reconciliation",
      entityId: rec.uuid,
      summary: `Deleted the reconciliation in progress for the statement of ${rec.statement_date}`
    });
    res.json({ data: {} });
  } catch (e) {
    sendError(res, e);
  }
};
