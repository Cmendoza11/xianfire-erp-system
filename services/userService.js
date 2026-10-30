import bcrypt from "bcryptjs";
import { Op } from "sequelize";
import { AdminUser } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { UUID_PATTERN } from "./accountService.js";
import { AccountingValidationError } from "./accountTypes.js";

export const ROLES = [
  { value: "admin", label: "Administrator", description: "Everything, including users, settings and period closing" },
  { value: "accountant", label: "Accountant", description: "All bookkeeping; no users, settings or period closing" },
  { value: "viewer", label: "Viewer", description: "Read-only access to records and reports" }
];

export const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toUser(row) {
  return {
    uuid: row.uuid,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    roleLabel: ROLES.find((r) => r.value === row.role)?.label ?? row.role,
    status: row.status ? 1 : 0,
    createdAt: row.createdAt ?? row.created_at,
    editUrl: urls.userEdit(row.uuid),
    updateApi: urls.updateUser(row.uuid)
  };
}

export async function listUsers() {
  const rows = await AdminUser.findAll({ order: [["full_name", "ASC"], ["email", "ASC"]], raw: true });
  return rows.map(toUser);
}

export async function getUser(uuid) {
  if (!uuid || !UUID_PATTERN.test(uuid)) return null;
  const row = await AdminUser.findOne({ where: { uuid }, raw: true });
  return row ? toUser(row) : null;
}

function assertPassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new AccountingValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

function assertRole(role) {
  if (!ROLES.some((r) => r.value === role)) {
    throw new AccountingValidationError("Select a valid role");
  }
}

export async function createUser(data) {
  const fullName = String(data?.full_name ?? "").trim();
  const email = String(data?.email ?? "").trim().toLowerCase();
  if (!fullName) throw new AccountingValidationError("Full name is required");
  if (!EMAIL_PATTERN.test(email)) throw new AccountingValidationError("Enter a valid email address");
  assertRole(data.role);
  assertPassword(data.password);
  if (await AdminUser.findOne({ where: { email } })) {
    throw new AccountingValidationError(`A user with the email ${email} already exists`);
  }
  const user = await AdminUser.create({
    full_name: fullName,
    email,
    role: data.role,
    password: await bcrypt.hash(data.password, 10),
    status: true
  });
  return toUser(user.get({ plain: true }));
}

// At least one active administrator must always remain, so nobody can lock the system out.
async function assertAnotherActiveAdmin(user) {
  const others = await AdminUser.count({
    where: { role: "admin", status: true, admin_user_id: { [Op.ne]: user.admin_user_id } }
  });
  if (others === 0) {
    throw new AccountingValidationError("At least one active administrator is required");
  }
}

export async function updateUser(uuid, data, actingUserId) {
  const user = UUID_PATTERN.test(uuid) ? await AdminUser.findOne({ where: { uuid } }) : null;
  if (!user) throw new AccountingValidationError("User not found");
  const before = toUser(user.get({ plain: true }));
  const fullName = String(data?.full_name ?? user.full_name ?? "").trim();
  if (!fullName) throw new AccountingValidationError("Full name is required");
  const role = data.role ?? user.role;
  assertRole(role);
  const status = data.status === undefined ? Boolean(user.status) : [1, "1", true, "true"].includes(data.status);
  const losesAdmin = user.role === "admin" && user.status && (role !== "admin" || !status);
  if (losesAdmin) await assertAnotherActiveAdmin(user);
  if (user.admin_user_id === actingUserId && !status) {
    throw new AccountingValidationError("You cannot deactivate your own account");
  }
  const changes = { full_name: fullName, role, status };
  if (data.password) {
    assertPassword(data.password);
    changes.password = await bcrypt.hash(data.password, 10);
  }
  await user.update(changes);
  return { before, after: toUser(user.get({ plain: true })), passwordChanged: Boolean(data.password) };
}

export async function changeOwnPassword(userId, data) {
  const user = await AdminUser.findByPk(userId);
  if (!user) throw new AccountingValidationError("User not found");
  if (!(await bcrypt.compare(String(data?.current_password ?? ""), user.password))) {
    throw new AccountingValidationError("The current password is incorrect");
  }
  assertPassword(data.new_password);
  if (data.new_password !== data.confirm_password) {
    throw new AccountingValidationError("The new passwords do not match");
  }
  await user.update({ password: await bcrypt.hash(data.new_password, 10) });
}
