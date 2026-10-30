import { urls } from "../routes/urls.js";
import { AccountingValidationError } from "../services/accountTypes.js";
import { diffFields, logAudit } from "../services/auditService.js";
import {
  changeOwnPassword,
  createUser as createUserRecord,
  getUser,
  listUsers,
  MIN_PASSWORD_LENGTH,
  ROLES,
  updateUser as updateUserRecord
} from "../services/userService.js";

function sendError(res, e) {
  if (e instanceof AccountingValidationError) {
    return res.status(400).json({ error: { status: 400, message: e.message } });
  }
  throw e;
}

export const userGrid = async (req, res) => {
  res.render("userGrid", { title: "Users", activeMenu: "users", urls, users: await listUsers(), roles: ROLES });
};

export const userNew = (req, res) => {
  res.render("userForm", {
    title: "New user",
    activeMenu: "users",
    urls,
    user: null,
    roles: ROLES.map((r) => ({ ...r, selected: r.value === "accountant" })),
    minPasswordLength: MIN_PASSWORD_LENGTH,
    form: { method: "POST", action: urls.createUser }
  });
};

export const userEdit = async (req, res, next) => {
  const user = await getUser(req.params.id);
  if (!user) return next();
  res.render("userForm", {
    title: user.fullName || user.email,
    activeMenu: "users",
    urls,
    user,
    roles: ROLES.map((r) => ({ ...r, selected: r.value === user.role })),
    minPasswordLength: MIN_PASSWORD_LENGTH,
    form: { method: "PATCH", action: urls.updateUser(user.uuid) }
  });
};

export const createUser = async (req, res) => {
  try {
    const user = await createUserRecord(req.body);
    await logAudit(req, {
      action: "user.create",
      entityType: "user",
      entityId: user.uuid,
      summary: `Created user ${user.email} (${user.roleLabel})`
    });
    res.json({ data: user });
  } catch (e) {
    sendError(res, e);
  }
};

export const updateUser = async (req, res) => {
  try {
    const { before, after, passwordChanged } = await updateUserRecord(req.params.id, req.body, req.adminUser?.admin_user_id);
    const changes = diffFields(before, after, ["fullName", "role", "status"]);
    if (Object.keys(changes).length > 0 || passwordChanged) {
      await logAudit(req, {
        action: "user.update",
        entityType: "user",
        entityId: after.uuid,
        summary: `Updated user ${after.email}: ${[...Object.keys(changes), ...(passwordChanged ? ["password reset"] : [])].join(", ")}`,
        details: changes
      });
    }
    res.json({ data: after });
  } catch (e) {
    sendError(res, e);
  }
};

export const changePasswordPage = (req, res) => {
  res.render("changePassword", { title: "Change password", activeMenu: "", urls, minPasswordLength: MIN_PASSWORD_LENGTH });
};

export const changePassword = async (req, res) => {
  try {
    await changeOwnPassword(req.adminUser.admin_user_id, req.body);
    await logAudit(req, { action: "user.password", entityType: "user", summary: `${req.adminUser.email} changed their password` });
    res.json({ data: {} });
  } catch (e) {
    sendError(res, e);
  }
};
