import bcrypt from "bcryptjs";
import { AdminUser } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { logAudit } from "../services/auditService.js";

const INVALID_LOGIN = "Invalid email or password";

export const loginPage = (req, res) => {
  if (req.adminUser) return res.redirect(urls.dashboard);
  res.render("login", { title: "Admin Login", urls });
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
  // A fresh session id on login prevents session fixation.
  req.session.regenerate((err) => {
    if (err) {
      console.error("❌ Session regenerate failed:", err);
      return res.status(500).json({ error: { status: 500, message: "Unable to log in" } });
    }
    req.session.userID = user.admin_user_id;
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error("❌ Session save failed:", saveErr);
        return res.status(500).json({ error: { status: 500, message: "Unable to log in" } });
      }
      res.json({ data: {} });
    });
  });
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
