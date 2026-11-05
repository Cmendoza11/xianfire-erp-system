import bcrypt from "bcryptjs";
import { AdminUser } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { logAudit } from "../services/auditService.js";
import { AccountingValidationError } from "../services/accountTypes.js";
import { createUser, MIN_PASSWORD_LENGTH } from "../services/userService.js";

const INVALID_LOGIN = "Invalid email or password";

// Self sign-up creates administrators, so it stays off unless ALLOW_SIGNUP=true is set in .env.
const signupEnabled = () => process.env.ALLOW_SIGNUP === "true";

// A fresh session id on login prevents session fixation.
function startSession(req, res, userId, failMessage) {
  req.session.regenerate((err) => {
    if (err) {
      console.error("❌ Session regenerate failed:", err);
      return res.status(500).json({ error: { status: 500, message: failMessage } });
    }
    req.session.userID = userId;
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error("❌ Session save failed:", saveErr);
        return res.status(500).json({ error: { status: 500, message: failMessage } });
      }
      res.json({ data: {} });
    });
  });
}

export const loginPage = (req, res) => {
  if (req.adminUser) return res.redirect(urls.dashboard);
  res.render("login", { title: "Admin Login", urls, signupEnabled: signupEnabled() });
};

export const loginUser = async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return res.status(400).json({ error: { status: 400, message: INVALID_LOGIN } });
  }
  // MySQL's default collation compares case-insensitively, matching the old ILIKE email lookup.
  const user = await AdminUser.findOne({ where: { email: email.trim(), status: true } });
  const match = await bcrypt.compare(password, user ? user.password : "");
  if (!user || !match) {
    await logAudit(req, {
      action: "auth.login_failed",
      summary: `Failed login attempt for ${email.trim()}`,
      user: { admin_user_id: user?.admin_user_id ?? null, email: email.trim() }
    });
    return res.status(401).json({ error: { status: 401, message: INVALID_LOGIN } });
  }
  await logAudit(req, {
    action: "auth.login",
    summary: `${user.full_name || user.email} logged in`,
    user: { admin_user_id: user.admin_user_id, email: user.email }
  });
  startSession(req, res, user.admin_user_id, "Unable to log in");
};

export const signupPage = (req, res, next) => {
  if (!signupEnabled()) return next();
  if (req.adminUser) return res.redirect(urls.dashboard);
  res.render("signup", { title: "Create account", urls, minPasswordLength: MIN_PASSWORD_LENGTH });
};

export const signupUser = async (req, res) => {
  if (!signupEnabled()) {
    return res.status(404).json({ error: { status: 404, message: "Sign-up is disabled" } });
  }
  const body = req.body ?? {};
  let user;
  try {
    if (body.password !== body.confirm_password) {
      throw new AccountingValidationError("Passwords do not match");
    }
    user = await createUser({
      full_name: body.full_name,
      email: body.email,
      password: body.password,
      role: "admin"
    });
  } catch (e) {
    if (e instanceof AccountingValidationError) {
      return res.status(400).json({ error: { status: 400, message: e.message } });
    }
    throw e;
  }
  const row = await AdminUser.findOne({ where: { uuid: user.uuid } });
  await logAudit(req, {
    action: "auth.signup",
    entityType: "user",
    entityId: user.uuid,
    summary: `${user.fullName || user.email} signed up`,
    user: { admin_user_id: row.admin_user_id, email: row.email }
  });
  startSession(req, res, row.admin_user_id, "Account created, but unable to log in");
};

export const logoutUser = async (req, res) => {
  if (req.adminUser) {
    await logAudit(req, {
      action: "auth.logout",
      summary: `${req.adminUser.full_name || req.adminUser.email} logged out`
    });
  }
  req.session.destroy((err) => {
    if (err) {
      console.error("❌ Session destroy failed:", err);
      return res.status(500).json({ error: { status: 500, message: "Logout failed" } });
    }
    res.clearCookie("connect.sid");
    res.json({ data: {} });
  });
};
