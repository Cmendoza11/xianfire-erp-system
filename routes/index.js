/*
    MIT License

    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */

import express from "express";
import { homePage } from "../controllers/homeController.js";
import { dashboardPage } from "../controllers/dashboardController.js";
import { loginPage, loginUser, logoutUser } from "../controllers/authController.js";
import {
  accountGrid, accountNew, accountEdit, createAccount, updateAccount, deleteAccount
} from "../controllers/accountController.js";
import {
  journalGrid, journalNew, journalView, createJournal, reverseJournal, deleteJournal
} from "../controllers/journalController.js";
import {
  contactGrid, contactNew, contactEdit, createContact, updateContact, deleteContact
} from "../controllers/contactController.js";
import {
  documentGrid, documentNew, documentView, createDocumentApi, recordPayment, voidPayment, voidDocument
} from "../controllers/documentController.js";
import {
  reconciliationGrid, reconciliationView, startReconciliation, toggleReconciliationLine,
  completeReconciliation, undoReconciliation, deleteReconciliation
} from "../controllers/bankRecController.js";
import { periodClosingPage, closePeriod, reopenPeriod } from "../controllers/periodController.js";
import { auditLogPage } from "../controllers/auditController.js";
import { accountingSettingPage, saveSetting } from "../controllers/settingController.js";
import {
  userGrid, userNew, userEdit, createUser, updateUser, changePasswordPage, changePassword
} from "../controllers/userController.js";
import {
  generalLedger, trialBalance, incomeStatement, balanceSheet, cashFlow, aging, vatSummary, documentBook
} from "../controllers/reportController.js";
import {
  requireAdmin, requireAdminApi, requireJson, requireRole, requireRoleApi, WRITE_ROLES
} from "../middleware/auth.js";

const router = express.Router();

// Express 4 does not forward rejected promises to the error handler on its own.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Every logged-in role can read; accountants and admins can write; only admins run the controls.
const read = requireAdmin;
const write = requireRole(...WRITE_ROLES);
const admin = requireRole("admin");
const writeApi = [requireRoleApi(...WRITE_ROLES)];
const writeJsonApi = [requireRoleApi(...WRITE_ROLES), requireJson];
const adminJsonApi = [requireRoleApi("admin"), requireJson];

router.get("/", homePage);

// Auth
router.get("/admin/login", loginPage);
router.post("/admin/user/login", requireJson, h(loginUser));
router.get("/admin/user/logout", h(logoutUser));
router.post("/admin/user/logout", h(logoutUser));
router.get("/admin/account/password", read, changePasswordPage);
router.post("/api/account/password", requireAdminApi, requireJson, h(changePassword));

// Dashboard and accounting
router.get("/admin", read, h(dashboardPage));
router.get("/admin/accounting/accounts", read, h(accountGrid));
router.get("/admin/accounting/accounts/new", write, accountNew);
router.get("/admin/accounting/accounts/edit/:id", write, h(accountEdit));
router.get("/admin/accounting/journal-entries", read, h(journalGrid));
router.get("/admin/accounting/journal-entries/new", write, h(journalNew));
router.get("/admin/accounting/journal-entries/view/:id", read, h(journalView));

// Sales and purchases
router.get("/admin/sales/customers", read, h(contactGrid("customer")));
router.get("/admin/sales/customers/new", write, contactNew("customer"));
router.get("/admin/sales/customers/edit/:id", write, h(contactEdit("customer")));
router.get("/admin/purchases/suppliers", read, h(contactGrid("supplier")));
router.get("/admin/purchases/suppliers/new", write, contactNew("supplier"));
router.get("/admin/purchases/suppliers/edit/:id", write, h(contactEdit("supplier")));
router.get("/admin/sales/invoices", read, h(documentGrid("invoice")));
router.get("/admin/sales/invoices/new", write, h(documentNew("invoice")));
router.get("/admin/sales/invoices/view/:id", read, h(documentView("invoice")));
router.get("/admin/purchases/bills", read, h(documentGrid("bill")));
router.get("/admin/purchases/bills/new", write, h(documentNew("bill")));
router.get("/admin/purchases/bills/view/:id", read, h(documentView("bill")));

// Banking
router.get("/admin/banking/reconciliations", read, h(reconciliationGrid));
router.get("/admin/banking/reconciliations/:id", read, h(reconciliationView));

// Reports
router.get("/admin/accounting/reports/general-ledger", read, h(generalLedger));
router.get("/admin/accounting/reports/trial-balance", read, h(trialBalance));
router.get("/admin/accounting/reports/income-statement", read, h(incomeStatement));
router.get("/admin/accounting/reports/balance-sheet", read, h(balanceSheet));
router.get("/admin/accounting/reports/cash-flow", read, h(cashFlow));
router.get("/admin/accounting/reports/ar-aging", read, h(aging("invoice")));
router.get("/admin/accounting/reports/ap-aging", read, h(aging("bill")));
router.get("/admin/accounting/reports/vat-summary", read, h(vatSummary));
router.get("/admin/accounting/reports/sales-book", read, h(documentBook("invoice")));
router.get("/admin/accounting/reports/purchase-book", read, h(documentBook("bill")));

// Controls (administrators)
router.get("/admin/setting/accounting", admin, h(accountingSettingPage));
router.get("/admin/accounting/period-closing", admin, h(periodClosingPage));
router.get("/admin/audit-log", admin, h(auditLogPage));
router.get("/admin/users", admin, h(userGrid));
router.get("/admin/users/new", admin, userNew);
router.get("/admin/users/edit/:id", admin, h(userEdit));

// JSON API
router.post("/api/accounting/accounts", ...writeJsonApi, h(createAccount));
router.patch("/api/accounting/accounts/:id", ...writeJsonApi, h(updateAccount));
router.delete("/api/accounting/accounts/:id", ...writeApi, h(deleteAccount));
router.post("/api/accounting/journal-entries", ...writeJsonApi, h(createJournal));
router.delete("/api/accounting/journal-entries/:id", ...writeApi, h(deleteJournal));
router.post("/api/accounting/journal-entries/:id/reverse", ...writeJsonApi, h(reverseJournal));
router.post("/api/contacts", ...writeJsonApi, h(createContact));
router.patch("/api/contacts/:id", ...writeJsonApi, h(updateContact));
router.delete("/api/contacts/:id", ...writeApi, h(deleteContact));
router.post("/api/sales/invoices", ...writeJsonApi, h(createDocumentApi("invoice")));
router.post("/api/purchases/bills", ...writeJsonApi, h(createDocumentApi("bill")));
router.post("/api/documents/:id/payments", ...writeJsonApi, h(recordPayment));
router.post("/api/documents/:id/void", ...writeJsonApi, h(voidDocument));
router.post("/api/payments/:id/void", ...writeJsonApi, h(voidPayment));
router.post("/api/banking/reconciliations", ...writeJsonApi, h(startReconciliation));
router.patch("/api/banking/reconciliations/:id/lines", ...writeJsonApi, h(toggleReconciliationLine));
router.post("/api/banking/reconciliations/:id/complete", ...writeJsonApi, h(completeReconciliation));
router.post("/api/banking/reconciliations/:id/undo", ...writeJsonApi, h(undoReconciliation));
router.delete("/api/banking/reconciliations/:id", ...writeApi, h(deleteReconciliation));
router.post("/api/accounting/periods/close", ...adminJsonApi, h(closePeriod));
router.post("/api/accounting/periods/reopen", ...adminJsonApi, h(reopenPeriod));
router.post("/api/settings", ...adminJsonApi, h(saveSetting));
router.post("/api/users", ...adminJsonApi, h(createUser));
router.patch("/api/users/:id", ...adminJsonApi, h(updateUser));

export default router;
