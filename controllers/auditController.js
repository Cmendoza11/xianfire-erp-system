import { buildPagination, positiveInt } from "../helpers/pagination.js";
import { urls } from "../routes/urls.js";
import { AUDIT_CATEGORIES, listAuditLogs } from "../services/auditService.js";

export const auditLogPage = async (req, res) => {
  const category = typeof req.query.category === "string" ? req.query.category : "";
  const logs = await listAuditLogs({
    page: positiveInt(req.query.page, 1),
    limit: positiveInt(req.query.limit, 50),
    category,
    keyword: typeof req.query.keyword === "string" ? req.query.keyword : ""
  });
  res.render("auditLog", {
    title: "Audit Log",
    activeMenu: "auditLog",
    urls,
    logs,
    categories: AUDIT_CATEGORIES.map((c) => ({ ...c, selected: c.value === category })),
    pagination: buildPagination(logs)
  });
};
