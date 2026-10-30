import { AdminUser } from "../models/index.js";
import { urls } from "../routes/urls.js";

// Resolves the logged-in admin for every request; a disabled or deleted user is logged out immediately.
export const loadAdminUser = async (req, res, next) => {
  try {
    const { userID } = req.session;
    if (!userID) return next();
    const user = await AdminUser.findOne({
      where: { admin_user_id: userID, status: true },
      attributes: ["admin_user_id", "email", "full_name", "role"]
    });
    if (!user) {
      delete req.session.userID;
      return next();
    }
    req.adminUser = user.get({ plain: true });
    res.locals.adminUser = {
      adminUserId: user.admin_user_id,
      email: user.email,
      fullName: user.full_name || user.email,
      initial: (user.full_name || user.email).charAt(0),
      roleLabel: ROLE_LABELS[user.role] ?? user.role
    };
    // Views use these flags only to hide controls; the routes enforce the same rules.
    res.locals.can = {
      write: WRITE_ROLES.includes(user.role),
      admin: user.role === "admin"
    };
    next();
  } catch (err) {
    next(err);
  }
};

export const ROLE_LABELS = { admin: "Administrator", accountant: "Accountant", viewer: "Viewer" };
export const WRITE_ROLES = ["admin", "accountant"];

// Pages: a logged-in user without the role sees a 403 page.
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.adminUser) return res.redirect(urls.adminLogin);
  if (!roles.includes(req.adminUser.role)) {
    return res.status(403).render("forbidden", { title: "Access denied", urls });
  }
  next();
};

// APIs: same rule, answered as JSON.
export const requireRoleApi = (...roles) => (req, res, next) => {
  if (!req.adminUser) {
    return res.status(401).json({ error: { status: 401, message: "Unauthorized" } });
  }
  if (!roles.includes(req.adminUser.role)) {
    return res
      .status(403)
      .json({ error: { status: 403, message: "Your role does not allow this action" } });
  }
  next();
};

export const requireAdmin = (req, res, next) => {
  if (!req.adminUser) return res.redirect(urls.adminLogin);
  next();
};

export const requireAdminApi = (req, res, next) => {
  if (!req.adminUser) {
    return res.status(401).json({ error: { status: 401, message: "Unauthorized" } });
  }
  next();
};

// JSON-only writes: a cross-site HTML form cannot send application/json, which blocks CSRF on these endpoints.
export const requireJson = (req, res, next) => {
  if (!req.is("application/json")) {
    return res
      .status(415)
      .json({ error: { status: 415, message: "Request body must be application/json" } });
  }
  next();
};
