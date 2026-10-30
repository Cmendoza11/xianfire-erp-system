import { Op } from "sequelize";
import { AuditLog } from "../models/index.js";

export const AUDIT_CATEGORIES = [
  { value: "auth", label: "Login / Logout" },
  { value: "account", label: "Accounts" },
  { value: "journal", label: "Journal entries" },
  { value: "contact", label: "Customers / suppliers" },
  { value: "document", label: "Invoices / bills" },
  { value: "payment", label: "Payments" },
  { value: "bankrec", label: "Bank reconciliation" },
  { value: "period", label: "Period closing" },
  { value: "settings", label: "Settings" },
  { value: "user", label: "Users" }
];

const ACTION_LABELS = {
  "auth.login": "Logged in",
  "auth.login_failed": "Failed login",
  "auth.logout": "Logged out",
  "account.create": "Created account",
  "account.update": "Updated account",
  "account.delete": "Deleted account",
  "journal.post": "Posted entry",
  "journal.reverse": "Reversed entry",
  "journal.delete": "Deleted entry",
  "contact.create": "Created contact",
  "contact.update": "Updated contact",
  "contact.delete": "Deleted contact",
  "document.create": "Issued document",
  "document.void": "Voided document",
  "payment.record": "Recorded payment",
  "payment.void": "Voided payment",
  "bankrec.start": "Started reconciliation",
  "bankrec.complete": "Completed reconciliation",
  "bankrec.undo": "Reopened reconciliation",
  "bankrec.delete": "Deleted reconciliation",
  "user.create": "Created user",
  "user.update": "Updated user",
  "user.password": "Changed password",
  "period.close": "Closed fiscal year",
  "period.reopen": "Reopened fiscal year",
  "settings.update": "Updated settings"
};

// Writing the trail must never undo an action that already succeeded, so a failed write is
// reported on the server console instead of being thrown back to the caller.
// `user` overrides the session user, for events such as login where the session is not set yet.
export async function logAudit(req, { action, entityType = null, entityId = null, summary, details = null, user }) {
  const actor = user ?? req.adminUser;
  try {
    await AuditLog.create({
      admin_user_id: actor?.admin_user_id ?? null,
      user_email: actor?.email ? String(actor.email).slice(0, 255) : null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      summary,
      details: details ? JSON.stringify(details) : null,
      ip_address: req.ip ?? null
    });
  } catch (err) {
    console.error(`❌ Audit log write failed for ${action}:`, err);
  }
}

// Field-by-field changes between two plain objects, limited to the given keys.
export function diffFields(before, after, keys) {
  const changes = {};
  for (const key of keys) {
    const from = before?.[key] ?? null;
    const to = after?.[key] ?? null;
    if (String(from) !== String(to)) changes[key] = { from, to };
  }
  return changes;
}

export async function listAuditLogs({ page = 1, limit = 50, category = "", keyword = "" } = {}) {
  const safePage = Math.max(1, page || 1);
  const safeLimit = Math.min(Math.max(1, limit || 50), 200);
  const where = {};
  if (AUDIT_CATEGORIES.some((c) => c.value === category)) {
    where.action = { [Op.like]: `${category}.%` };
  }
  if (keyword && keyword.trim()) {
    const like = `%${keyword.trim()}%`;
    where[Op.or] = [{ summary: { [Op.like]: like } }, { user_email: { [Op.like]: like } }];
  }
  const { rows, count } = await AuditLog.findAndCountAll({
    where,
    order: [["created_at", "DESC"], ["audit_log_id", "DESC"]],
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
    raw: true
  });
  return {
    items: rows.map((r) => ({
      // raw rows are keyed by attribute name, so the timestamp comes back as createdAt.
      createdAt: r.createdAt,
      userEmail: r.user_email,
      action: r.action,
      actionLabel: ACTION_LABELS[r.action] ?? r.action,
      isFailure: r.action === "auth.login_failed",
      summary: r.summary,
      details: r.details ? JSON.stringify(JSON.parse(r.details), null, 2) : null,
      ipAddress: r.ip_address
    })),
    total: count,
    page: safePage,
    limit: safeLimit,
    keyword: keyword ?? "",
    category
  };
}
